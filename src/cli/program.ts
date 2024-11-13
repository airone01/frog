import {Command} from 'commander';
import {type FileSystem} from '../infrastructure/fs/file-system';
import {type Logger} from '../infrastructure/logging/logger';
import {type Config} from '../infrastructure/config/config';
import {type PackageInstaller} from '../core/package/package-installer';
import {type PackageUninstaller} from '../core/package/package-uninstaller';
import {type PackageUpdater} from '../core/package/package-updater';
import {type RegistryManager} from '../core/registry/registry-manager';
import {version} from '../../package.json';
import {title} from '../figlet';
import {createCommands} from './commands';

export function createProgram( // eslint-disable-line max-params
  fs: FileSystem,
  logger: Logger,
  config: Config,
  installer: PackageInstaller,
  uninstaller: PackageUninstaller,
  updater: PackageUpdater,
  registryManager: RegistryManager,
): Command {
  const program = new Command()
    .name('diem')
    .description('Custom package manager for 42 School environment')
    .version(version);

  program.addHelpText('before', `${title}\n`);

  createCommands(
    program,
    fs,
    logger,
    config,
    installer,
    uninstaller,
    updater,
    registryManager,
  );

  return program;
}
