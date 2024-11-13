import {join} from 'node:path';
import {type Package, type PackageReference} from '../../domain/models';
import {type FileSystem} from '../../infrastructure/fs/file-system';
import {type Logger} from '../../infrastructure/logging/logger';
import {type Config} from '../../infrastructure/config/config';
import {type PackageRepository} from '../../domain/repositories/package-repository';
import {compareVersions} from '../../utils/version';
import {PackageError} from '../../domain/errors/package-error';
import {type PackageInstaller} from './package-installer';

type UpdateOptions = {
  force?: boolean;
};

export class PackageUpdater {
  constructor( // eslint-disable-line max-params
    private readonly fs: FileSystem,
    private readonly logger: Logger,
    private readonly config: Config,
    private readonly packageRepo: PackageRepository,
    private readonly installer: PackageInstaller,
  ) {}

  async update(
    reference: PackageReference,
    newPackage: Package,
    options: UpdateOptions = {},
  ): Promise<void> {
    const currentPackage = await this.packageRepo.findByReference(reference);
    if (!currentPackage) {
      throw new PackageError(
        `Package ${reference.name} not found`,
        'PKG_NOT_FOUND',
      );
    }

    // Check if update is needed
    if (this.isSameVersion(currentPackage, newPackage) && !options.force) {
      this.logger.info(
        `Package ${reference.name} is already at version ${currentPackage.version}`,
      );
      return;
    }

    try {
      await this.performUpdate(reference, currentPackage, newPackage, options);
    } catch (error) {
      await this.handleUpdateFailure(reference, currentPackage, error as Error);
    }
  }

  async updateAll(options: UpdateOptions = {}): Promise<void> {
    const packages = await this.packageRepo.list();
    const results: Array<{name: string; success: boolean; error?: Error}> = [];

    for (const package_ of packages) {
      try {
        const reference: PackageReference = {
          provider: package_.provider ?? 'default',
          name: package_.name,
        };

        // Get latest version info
        const latestPackage = await this.packageRepo.findByReference(reference); // eslint-disable-line no-await-in-loop
        if (!latestPackage) {
          throw new PackageError(
            `Unable to find latest version for ${package_.name}`,
            'PKG_NOT_FOUND',
          );
        }

        await this.update(reference, latestPackage, options); // eslint-disable-line no-await-in-loop
        results.push({name: package_.name, success: true});
      } catch (error) {
        results.push({
          name: package_.name,
          success: false,
          error: error as Error,
        });
      }
    }

    this.logUpdateResults(results);
  }

  private async performUpdate(
    reference: PackageReference,
    currentPackage: Package,
    newPackage: Package,
    options: UpdateOptions,
  ): Promise<void> {
    this.logger.info(
      `Updating ${reference.name} from ${currentPackage.version} to ${newPackage.version}`,
    );

    // Create backup
    const backupDirectory = await this.createBackup(reference, currentPackage);

    try {
      // Remove current installation but keep the backup
      await this.fs.remove(this.getPackageDirectory(reference));

      // Install new version
      await this.installer.install(newPackage, reference, options.force);

      // Update package repository
      await this.packageRepo.save(newPackage);

      // Clean up backup on success
      await this.fs.remove(backupDirectory);

      this.logger.info(
        `Successfully updated ${reference.name} to version ${newPackage.version}`,
      );
    } catch (error) {
      throw new PackageError(
        `Failed to update ${reference.name}`,
        'UPDATE_FAILED',
        error as Error,
      );
    }
  }

  private async handleUpdateFailure(
    reference: PackageReference,
    currentPackage: Package,
    error: Error,
  ): Promise<void> {
    this.logger.error(`Update failed: ${error.message}`);
    this.logger.info('Attempting to rollback...');

    const backupDirectory = this.getBackupDirectory(reference, currentPackage);
    const packageDirectory = this.getPackageDirectory(reference);

    try {
      if (await this.fs.exists(packageDirectory)) {
        await this.fs.remove(packageDirectory);
      }

      if (await this.fs.exists(backupDirectory)) {
        await this.fs.copy(backupDirectory, packageDirectory);
        await this.packageRepo.save(currentPackage);
        this.logger.info('Successfully rolled back to previous version');
      } else {
        this.logger.error('Backup not found, unable to rollback');
      }
    } catch (rollbackError) {
      this.logger.error(
        'Rollback failed, system may be in an inconsistent state:',
        rollbackError,
      );
    }

    throw error;
  }

  private async createBackup(
    reference: PackageReference,
    package_: Package,
  ): Promise<string> {
    const packageDirectory = this.getPackageDirectory(reference);
    const backupDirectory = this.getBackupDirectory(reference, package_);

    if (await this.fs.exists(packageDirectory)) {
      await this.fs.copy(packageDirectory, backupDirectory);
      this.logger.debug(`Created backup at ${backupDirectory}`);
    }

    return backupDirectory;
  }

  private getPackageDirectory(reference: PackageReference): string {
    const directoryName = reference.provider
      ? `${reference.provider}_${reference.name}`
      : reference.name;
    return join(this.config.packageRoot, directoryName);
  }

  private getBackupDirectory(reference: PackageReference, package_: Package): string {
    const baseDirectory = this.getPackageDirectory(reference);
    return `${baseDirectory}_backup_${package_.version}`;
  }

  private isSameVersion(current: Package, new_: Package): boolean {
    return compareVersions(current.version, new_.version) === 0;
  }

  private logUpdateResults(
    results: Array<{name: string; success: boolean; error?: Error}>,
  ): void {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length > 0) {
      this.logger.info('Successfully updated packages:');
      for (const r of successful) {
        this.logger.info(`  - ${r.name}`);
      }
    }

    if (failed.length > 0) {
      this.logger.error('Failed to update packages:');
      for (const r of failed) {
        this.logger.error(`  - ${r.name}: ${r.error?.message}`);
      }
    }
  }
}
