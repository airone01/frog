/* eslint-disable no-await-in-loop */
import {join} from 'node:path';
import {mkdir, chmod} from 'node:fs/promises';
import {type Package, type PackageReference} from '../../domain/models';
import {type FileSystem} from '../../infrastructure/fs/file-system';
import {type Logger} from '../../infrastructure/logging/logger';
import {type Config} from '../../infrastructure/config/config';
import {PackageError, PackageInstallError} from '../../domain/errors/package-error';

export class PackageInstaller {
  constructor(
    private readonly fs: FileSystem,
    private readonly logger: Logger,
    private readonly config: Config,
  ) {}

  async install(package_: Package, reference: PackageReference, force = false): Promise<void> {
    try {
      this.logger.info(`Installing package ${package_.name}`);

      const packageDirectory = this.getPackageDirectory(reference);
      await this.prepareDirectory(packageDirectory);

      if (package_.url) {
        await this.downloadPackage(package_.url, packageDirectory);
      }

      if (package_.installScript) {
        await this.runInstallScript(package_.installScript, packageDirectory);
      }

      await this.createSymlinks(package_.binaries, packageDirectory, force);

      this.logger.info(`Successfully installed ${package_.name}`);
    } catch (error) {
      throw new PackageInstallError(package_.name, error as Error);
    }
  }

  private getPackageDirectory(reference: PackageReference): string {
    const directoryName = reference.provider
      ? `${reference.provider}_${reference.name}`
      : reference.name;
    return join(this.config.packageRoot, directoryName);
  }

  private async prepareDirectory(directory: string): Promise<void> {
    await mkdir(directory, {recursive: true});
  }

  private async downloadPackage(url: string, destinationDirectory: string): Promise<void> {
    this.logger.debug(`Downloading package from ${url}`);
    // Implementation of download logic
  }

  private async runInstallScript(script: string, cwd: string): Promise<void> {
    this.logger.debug('Running install script');
    // Implementation of script execution
  }

  private async createSymlinks(
    binaries: string[],
    packageDirectory: string,
    force: boolean,
  ): Promise<void> {
    for (const binary of binaries) {
      const source = join(packageDirectory, binary);
      const target = join(this.config.binariesPath, binary);

      if (await this.fs.exists(target) && !force) {
        throw new PackageError(
          `Binary ${binary} already exists`,
          'BINARY_EXISTS',
        );
      }

      await this.fs.symlink(source, target);
      await chmod(source, 0o755);
    }
  }
}
