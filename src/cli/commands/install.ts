import {Command} from 'commander';
import {type FileSystem} from '../../infrastructure/fs/file-system';
import {type Logger} from '../../infrastructure/logging/logger';
import {type Config} from '../../infrastructure/config/config';
import {type PackageInstaller} from '../../core/package/package-installer';
import {type RegistryManager} from '../../core/registry/registry-manager';
import {PackageReference, parsePackageReference} from '../../domain/models/package-reference';

type InstallCommandOptions = {
  force?: boolean;
};

export function createInstallCommand( // eslint-disable-line max-params
  fs: FileSystem,
  logger: Logger,
  config: Config,
  installer: PackageInstaller,
  registryManager: RegistryManager,
): Command {
  return new Command('install')
    .description('Install a package (format: [provider:]package)')
    .argument('<package>', 'Package to install')
    .option('-f, --force', 'Force installation even if binaries exist')
    .action(async (packageArgument: string, options: InstallCommandOptions) => {
      try {
        // Parse package reference
        const reference = await parsePackageReference(
          packageArgument,
          await registryManager.getDefaultProvider(),
        );

        // Resolve package location
        const location = await registryManager.resolvePackageLocation(reference);
        if (!location) {
          logger.error(`Package ${packageArgument} not found`);
          process.exit(1);
        }

        // Get package info
        const packageInfo = await registryManager.getPackageInfo(location);
        if (!packageInfo) {
          logger.error(`Invalid package configuration at ${location}`);
          process.exit(1);
        }

        // Install package
        await installer.install(packageInfo, reference, options);
        logger.info(`Successfully installed ${packageArgument}`);
      } catch (error) {
        logger.error('Installation failed:', error);
        process.exit(1);
      }
    });
}
