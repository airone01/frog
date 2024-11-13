import {join} from 'node:path';
import {Package, type PackageReference, PackageError} from '../../domain/models';
import {type FileSystem} from '../../infrastructure/fs/FileSystem';
import {type Logger} from '../../infrastructure/logging/Logger';
import {type Config} from '../../infrastructure/config/Config';
import {type PackageRepository} from '../../domain/repositories/PackageRepository';

export class PackageUninstaller {
  constructor(
    private readonly fs: FileSystem,
    private readonly logger: Logger,
    private readonly config: Config,
    private readonly packageRepo: PackageRepository,
  ) {}

  async uninstall(reference: PackageReference): Promise<void> {
    this.logger.info(`Uninstalling package ${reference.name}`);

    const package_ = await this.packageRepo.findByReference(reference);
    if (!package_) {
      throw new PackageError(
        `Package ${reference.name} not found`,
        'PKG_NOT_FOUND',
      );
    }

    try {
      await this.removeSymlinks(package_.binaries);
      await this.removePackageFiles(reference);
      await this.packageRepo.remove(package_.name);

      this.logger.info(`Successfully uninstalled ${package_.name}`);
    } catch (error) {
      throw new PackageError(
        `Failed to uninstall ${package_.name}`,
        'UNINSTALL_FAILED',
        error as Error,
      );
    }
  }

  private async removeSymlinks(binaries: string[]): Promise<void> {
    for (const binary of binaries) {
      const symlinkPath = join(this.config.binariesPath, binary);

      if (await this.fs.exists(symlinkPath)) {
        try {
          await this.fs.remove(symlinkPath);
          this.logger.debug(`Removed symlink: ${symlinkPath}`);
        } catch (error) {
          this.logger.warn(`Failed to remove symlink ${symlinkPath}:`, error);
        }
      }
    }
  }

  private async removePackageFiles(reference: PackageReference): Promise<void> {
    const packageDir = this.getPackageDirectory(reference);

    if (await this.fs.exists(packageDir)) {
      await this.fs.remove(packageDir);
      this.logger.debug(`Removed package directory: ${packageDir}`);
    }

    // Clean up goinfre directory if it exists
    const goinfreDir = join(this.config.goinfre, reference.name);
    if (await this.fs.exists(goinfreDir)) {
      await this.fs.remove(goinfreDir);
      this.logger.debug(`Removed goinfre directory: ${goinfreDir}`);
    }
  }

  private getPackageDirectory(reference: PackageReference): string {
    const dirName = reference.provider
      ? `${reference.provider}_${reference.name}`
      : reference.name;
    return join(this.config.packageRoot, dirName);
  }
}
