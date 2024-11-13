import {exit} from 'node:process';
import {type Command} from 'commander';
import {type FileSystem} from '../../infrastructure/fs/file-system';
import {type Logger} from '../../infrastructure/logging/logger';
import {type Config} from '../../infrastructure/config/config';
import {type PackageInstaller} from '../../core/package/package-installer';
import {type PackageUninstaller} from '../../core/package/package-uninstaller';
import {type PackageUpdater} from '../../core/package/package-updater';
import {type RegistryManager, parsePackageReference} from '../../core/registry/registry-manager';

type CommandOptions = {
  force?: boolean;
  available?: boolean;
};

export function createCommands( // eslint-disable-line max-params
  program: Command,
  fs: FileSystem,
  logger: Logger,
  config: Config,
  installer: PackageInstaller,
  uninstaller: PackageUninstaller,
  updater: PackageUpdater,
  registryManager: RegistryManager,
): void {
  // Install command
  program
    .command('install')
    .description('Install a package (format: [provider:]package)')
    .argument('<package>', 'Package to install')
    .option('-f, --force', 'Force installation even if binaries exist')
    .action(async (packageArgument: string, options: CommandOptions) => {
      try {
        // Parse package reference
        const reference = parsePackageReference(
          packageArgument,
          await registryManager.getDefaultProvider(),
        );

        // Resolve package location
        const location = await registryManager.resolvePackageLocation(reference);
        const packageInfo = await registryManager.getPackageInfo(location);

        // Install package
        await installer.install(packageInfo, reference, options.force);
        logger.info(`Successfully installed ${packageArgument}`);
      } catch (error) {
        logger.error('Installation failed:', error);
        exit(1);
      }
    });

  // Uninstall command
  program
    .command('uninstall')
    .description('Uninstall a package')
    .argument('<package>', 'Package to uninstall')
    .action(async (packageArgument: string) => {
      try {
        const reference = parsePackageReference(
          packageArgument,
          await registryManager.getDefaultProvider(),
        );

        await uninstaller.uninstall(reference);
        logger.info(`Successfully uninstalled ${packageArgument}`);
      } catch (error) {
        logger.error('Uninstallation failed:', error);
        exit(1);
      }
    });

  // Update command
  program
    .command('update')
    .description('Update all packages or a specific package')
    .argument('[package]', 'Package to update (optional)')
    .option('-f, --force', 'Force update even if binaries exist')
    .action(async (packageArgument?: string, options: CommandOptions = {}) => {
      try {
        if (packageArgument) {
          const reference = parsePackageReference(
            packageArgument,
            await registryManager.getDefaultProvider(),
          );

          const location = await registryManager.resolvePackageLocation(reference);
          const packageInfo = await registryManager.getPackageInfo(location);

          await updater.update(reference, packageInfo, options);
          logger.info(`Successfully updated ${packageArgument}`);
        } else {
          await updater.updateAll(options);
        }
      } catch (error) {
        logger.error('Update failed:', error);
        exit(1);
      }
    });

  // List command
  program
    .command('list')
    .description('List installed packages')
    .option('-a, --available', 'List available packages that are not installed')
    .action(async (options: CommandOptions) => {
      try {
        if (options.available) {
          const packages = await registryManager.listPackages();
          if (packages.length === 0) {
            logger.info('No packages available');
            return;
          }

          logger.info('Available packages:');
          for (const package_ of packages) {
            const providerInfo = package_.provider ? ` (from ${package_.provider})` : '';
            logger.info(`  - ${package_.name}@${package_.version}${providerInfo}`);
          }
        } else {
          const installedPackages = await installer.listInstalled();
          if (installedPackages.length === 0) {
            logger.info('No packages installed');
            return;
          }

          logger.info('Installed packages:');
          for (const package_ of installedPackages) {
            const providerInfo = package_.provider ? ` (from ${package_.provider})` : '';
            logger.info(`  - ${package_.name}@${package_.version}${providerInfo}`);
          }
        }
      } catch (error) {
        logger.error('Failed to list packages:', error);
        exit(1);
      }
    });

  // Search command
  program
    .command('search')
    .description('Search for packages')
    .argument('<query>', 'Search query')
    .action(async (query: string) => {
      try {
        const results = await registryManager.searchPackages(query);
        if (results.length === 0) {
          logger.info('No packages found matching your query');
          return;
        }

        logger.info('Matching packages:');
        for (const package_ of results) {
          const providerInfo = package_.provider ? ` (from ${package_.provider})` : '';
          logger.info(`  - ${package_.name}@${package_.version}${providerInfo}`);
          if (package_.url) {
            logger.info(`    Source: ${package_.url}`);
          }
        }
      } catch (error) {
        logger.error('Search failed:', error);
        exit(1);
      }
    });

  // Provider commands
  const providerCommand = program
    .command('provider')
    .description('Manage package providers');

  providerCommand
    .command('add')
    .description('Add a package provider')
    .argument('<username>', 'Provider username')
    .action(async (username: string) => {
      try {
        await registryManager.addProvider(username);
        logger.info(`Successfully added provider: ${username}`);
      } catch (error) {
        logger.error('Failed to add provider:', error);
        exit(1);
      }
    });

  providerCommand
    .command('remove')
    .description('Remove a package provider')
    .argument('<username>', 'Provider username')
    .action(async (username: string) => {
      try {
        await registryManager.removeProvider(username);
        logger.info(`Successfully removed provider: ${username}`);
      } catch (error) {
        logger.error('Failed to remove provider:', error);
        exit(1);
      }
    });

  providerCommand
    .command('default')
    .description('Set default provider')
    .argument('<username>', 'Provider username')
    .action(async (username: string) => {
      try {
        await registryManager.setDefaultProvider(username);
        logger.info(`Successfully set default provider: ${username}`);
      } catch (error) {
        logger.error('Failed to set default provider:', error);
        exit(1);
      }
    });

  providerCommand
    .command('list')
    .description('List configured providers')
    .action(async () => {
      try {
        await registryManager.listProviders();
      } catch (error) {
        logger.error('Failed to list providers:', error);
        exit(1);
      }
    });

  // Sync command
  program
    .command('sync')
    .description('Sync packages to goinfre')
    .action(async () => {
      try {
        await installer.sync();
        logger.info('Successfully synced packages to goinfre');
      } catch (error) {
        logger.error('Sync failed:', error);
        exit(1);
      }
    });
}
