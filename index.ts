import {exit} from 'node:process';
import {program} from 'commander';
import {z} from 'zod';
import {PackageManager} from './src/package-manager';
import {version} from './package.json' assert { type: 'json' };
import {logger} from './src/logger';

program
  .name('package-manager')
  .description('Custom package manager for 42 School environment')
  .version(version);

program
  .command('install <package>')
  .description('Install a package')
  .option('-f, --force', 'Force installation even if binaries exist')
  .action(async (_package, options) => {
    const manager = new PackageManager();
    try {
      const {success: packageSuccess, data: __package} = z.string().safeParse(_package);

      if (!packageSuccess) {
        throw new Error('Please provide a package name.');
      }

      const {success: optionsSuccess, data: __options} = z.object({force: z.boolean()}).safeParse(options);

      await manager.install(__package, __options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Error:', error.message);
      } else {
        logger.error('Error:', error);
      }

      exit(1);
    }
  });

program
  .command('uninstall <package>')
  .description('Uninstall a package')
  .action(async _package => {
    const manager = new PackageManager();
    try {
      const {success: packageSuccess, data: __package} = z.string().safeParse(_package);

      if (!packageSuccess) {
        throw new Error('Please provide a package name.');
      }

      await manager.uninstall(__package);
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Error:', error.message);
      } else {
        logger.error('Error:', error);
      }

      exit(1);
    }
  });

program
  .command('sync')
  .description('Sync packages to goinfre')
  .action(async () => {
    const manager = new PackageManager();
    try {
      await manager.sync();
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Error:', error.message);
      } else {
        logger.error('Error:', error);
      }

      exit(1);
    }
  });

program
  .command('list')
  .description('List installed packages')
  .action(async () => {
    const manager = new PackageManager();
    try {
      await manager.list();
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Error:', error.message);
      } else {
        logger.error('Error:', error);
      }

      exit(1);
    }
  });

program
  .command('search <query>')
  .description('Search for available packages')
  .action(async query => {
    const manager = new PackageManager();
    try {
      const {success: querySuccess, data: __query} = z.string().safeParse(query);

      if (!querySuccess) {
        throw new Error('Please provide a search query.');
      }

      await manager.search(__query);
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Error:', error.message);
      } else {
        logger.error('Error:', error);
      }

      exit(1);
    }
  });

program.parse();
