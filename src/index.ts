import {exit} from 'node:process';
import {argv} from 'bun';
import {createProgram} from './cli/program';
import {NodeFileSystem} from './infrastructure/fs/node-file-system';
import {WinstonLogger} from './infrastructure/logging/winston-logger';
import {Config} from './infrastructure/config/config';
import {PackageInstaller} from './core/package/package-installer';
import {PackageUninstaller} from './core/package/package-uninstaller';
import {PackageUpdater} from './core/package/package-updater';
import {RegistryManager} from './core/registry/registry-manager';
import {PackageRepository} from './infrastructure/repositories/package-repository';

async function main() {
  // Initialize core dependencies
  const logger = new WinstonLogger();
  const fs = new NodeFileSystem(logger);
  const config = new Config(fs, logger);

  // Initialize config and ensure it's ready
  await config.initialize();
  await config.validate();

  // Initialize repositories
  const packageRepo = new PackageRepository(fs, logger, config);
  await packageRepo.initialize();

  // Initialize managers
  const registryManager = new RegistryManager(fs, logger, config);
  await registryManager.initialize();

  // Initialize package handlers
  const installer = new PackageInstaller(fs, logger, config);
  const uninstaller = new PackageUninstaller(fs, logger, config, packageRepo);
  const updater = new PackageUpdater(fs, logger, config, packageRepo, installer);

  // Create and run program
  const program = createProgram(
    fs,
    logger,
    config,
    installer,
    uninstaller,
    updater,
    registryManager,
  );

  try {
    await program.parseAsync(argv);
  } catch (error) {
    logger.error('Fatal error:', error);
    exit(1);
  }
}

await main();
