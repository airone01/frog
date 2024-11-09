import {exit} from 'node:process';
import {program} from 'commander';
import {z} from 'zod';
import {mightFail, mightFailSync} from '@might/fail';
import {version, name} from '../package.json' assert { type: 'json' };
import {PackageManager} from './package-manager';
import {logger} from './logger';

program
  .name(name)
  .description('Custom package manager for 42 School environment')
  .version(version);

program
  .command('install <package>')
  .description('Install a package')
  .option('-f, --force', 'Force installation even if binaries exist')
  .action(async (_package, options) => {
    const manager = new PackageManager();

    const [validatePackageError, packageName] = mightFailSync(() => {
      const {success, data} = z.string().safeParse(_package);
      if (!success) {
        throw new Error('Please provide a valid package name.');
      }

      return data;
    });

    if (validatePackageError) {
      logger.error('Error:', validatePackageError.message);
      exit(1);
    }

    const [validateOptionsError, validOptions] = mightFailSync(() => {
      const {success, data} = z.object({force: z.boolean()}).safeParse(options);
      if (!success) {
        throw new Error('Invalid options provided.');
      }

      return data;
    });

    if (validateOptionsError) {
      logger.error('Error:', validateOptionsError.message);
      exit(1);
    }

    const [installError] = await mightFail(manager.install(packageName, validOptions));
    if (installError) {
      logger.error('Installation error:', installError.message);
      exit(1);
    }
  });

program
  .command('uninstall <package>')
  .description('Uninstall a package')
  .action(async _package => {
    const manager = new PackageManager();

    const [validateError, packageName] = mightFailSync(() => {
      const {success, data} = z.string().safeParse(_package);
      if (!success) {
        throw new Error('Please provide a valid package name.');
      }

      return data;
    });

    if (validateError) {
      logger.error('Error:', validateError.message);
      exit(1);
    }

    const [uninstallError] = await mightFail(manager.uninstall(packageName));
    if (uninstallError) {
      logger.error('Uninstallation error:', uninstallError.message);
      exit(1);
    }
  });

program
  .command('sync')
  .description('Sync packages to goinfre')
  .action(async () => {
    const manager = new PackageManager();
    const [syncError] = await mightFail(manager.sync());
    if (syncError) {
      logger.error('Sync error:', syncError.message);
      exit(1);
    }
  });

program
  .command('list')
  .description('List installed packages')
  .option('-a, --available', 'List available packages that are not installed')
  .action(async options => {
    const manager = new PackageManager();

    const [validateError, validOptions] = mightFailSync(() => {
      const {success, data} = z
        .object({available: z.boolean().optional()})
        .safeParse(options);
      if (!success) {
        throw new Error('Invalid options provided.');
      }

      return data;
    });

    if (validateError) {
      logger.error('Error:', validateError.message);
      exit(1);
    }

    const [listError] = await mightFail(manager.list(validOptions));
    if (listError) {
      logger.error('List error:', listError.message);
      exit(1);
    }
  });

program
  .command('search <query>')
  .description('Search for available packages')
  .action(async query => {
    const manager = new PackageManager();

    const [validateError, validQuery] = mightFailSync(() => {
      const {success, data} = z.string().safeParse(query);
      if (!success) {
        throw new Error('Please provide a valid search query.');
      }

      return data;
    });

    if (validateError) {
      logger.error('Error:', validateError.message);
      exit(1);
    }

    const [searchError] = await mightFail(manager.search(validQuery));
    if (searchError) {
      logger.error('Search error:', searchError.message);
      exit(1);
    }
  });

program
  .command('update [package]')
  .description('Update all packages or a specific package')
  .option('-f, --force', 'Force update even if binaries exist')
  .action(async (_package, options) => {
    const manager = new PackageManager();

    const [validateOptionsError, validOptions] = mightFailSync(() => {
      const {success, data} = z.object({force: z.boolean()}).safeParse(options);
      if (!success) {
        return {force: false}; // Default options if validation fails
      }

      return data;
    });

    if (validateOptionsError) {
      logger.error('Error:', validateOptionsError.message);
      exit(1);
    }

    if (_package) {
      const [validatePackageError, packageName] = mightFailSync(() => {
        const {success, data} = z.string().safeParse(_package);
        if (!success) {
          throw new Error('Please provide a valid package name.');
        }

        return data;
      });

      if (validatePackageError) {
        logger.error('Error:', validatePackageError.message);
        exit(1);
      }

      const [updateError] = await mightFail(manager.update(packageName, validOptions));
      if (updateError) {
        logger.error('Update error:', updateError.message);
        exit(1);
      }
    } else {
      const [updateAllError] = await mightFail(manager.updateAll(validOptions));
      if (updateAllError) {
        logger.error('Update all error:', updateAllError.message);
        exit(1);
      }
    }
  });

program.parse();
