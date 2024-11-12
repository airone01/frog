/* eslint-disable no-await-in-loop */
import {join, basename, dirname} from 'node:path';
import {homedir, userInfo} from 'node:os';
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import {z} from 'zod';
import {$} from 'bun';
import {mightFail, mightFailSync} from '@might/fail';
import {logger} from './logger';
import {parsePackageReference} from './config-types';
import {RegistryManager} from './registry-manager';

// Zod schemas
const zPackageConfig = z.object({
  name: z.string(),
  version: z.string(),
  binaries: z.array(z.string()),
  installScript: z.string().optional(),
  url: z.string().url().optional(),
  provider: z.string().optional(),
});

const zPackageDatabase = z.record(z.string(), zPackageConfig);

const zRegistry = z.record(z.string(), z.object({
  url: z.string().url(),
}));

type PackageConfig = z.infer<typeof zPackageConfig>;
type PackageDatabase = z.infer<typeof zPackageDatabase>;

type PackageSource = {
  type: 'local' | 'provider' | 'remote';
  location: string;
  provider?: string;
};

class PackageManager {
  private readonly homePath: string;
  private readonly sgoinfrePath: string;
  private readonly goinfrePath: string;
  private readonly binPath: string;
  private readonly packageDb: string;
  private readonly username: string;
  private readonly registryManager: RegistryManager;

  constructor() {
    this.homePath = homedir();
    this.username = userInfo().username;
    this.sgoinfrePath = join('/sgoinfre', this.username, 'packages');
    this.goinfrePath = join('/goinfre', this.username, 'packages');
    this.binPath = join(this.homePath, 'bin');
    this.packageDb = join(this.sgoinfrePath, 'package-db.json');
    this.registryManager = new RegistryManager();

    this.ensureDirectories();
  }

  public async install(packageReference: string, options: {force?: boolean} = {}): Promise<void> { // eslint-disable-line complexity
    logger.info(`Installing package '${packageReference}'`);

    const [sourceError, source] = await mightFail(this.resolvePackage(packageReference));
    if (sourceError) {
      logger.error('Failed to resolve package source:', sourceError);
      return;
    }

    let packageDirectory: string;

    // Generate package directory name based on source type and reference
    const packageDirectoryName = source.type === 'provider' && source.provider
      ? `${source.provider}_${basename(source.location)}`
      : basename(source.location);

    switch (source.type) {
      case 'provider': {
        logger.debug('Copying from provider directory...');
        packageDirectory = join(this.sgoinfrePath, packageDirectoryName);
        const [copyError] = mightFailSync(() => {
          cpSync(source.location, packageDirectory, {recursive: true});
        },
        );
        if (copyError) {
          logger.error('Failed to copy from provider directory:', copyError);
          return;
        }

        break;
      }

      case 'local': {
        logger.debug('Copying from local path...');
        packageDirectory = join(this.sgoinfrePath, packageDirectoryName);
        const [copyError] = mightFailSync(() => {
          cpSync(source.location, packageDirectory, {recursive: true});
        },
        );
        if (copyError) {
          logger.error('Failed to copy from local path:', copyError);
          return;
        }

        break;
      }

      case 'remote': {
        logger.debug('Preparing for download...');
        packageDirectory = join(this.sgoinfrePath, packageDirectoryName);
        const [mkdirError] = mightFailSync(() =>
          mkdirSync(packageDirectory, {recursive: true}),
        );
        if (mkdirError) {
          logger.error('Failed to create package directory:', mkdirError);
          return;
        }

        const [downloadError] = await mightFail(
          this.downloadPackage(source.location, packageDirectory),
        );
        if (downloadError) {
          logger.error('Failed to download package:', downloadError);
          return;
        }

        break;
      }
    }

    const configPath = join(packageDirectory, 'package.json');
    const [configError, config] = await mightFail(this.loadPackageConfig(configPath));
    if (configError ?? !config) {
      logger.error('Failed to load package configuration:', configError);
      return;
    }

    // Update config with provider information if from a provider
    if (source.type === 'provider' && source.provider) {
      config.provider = source.provider;
      const [writeError] = mightFailSync(() => {
        writeFileSync(configPath, JSON.stringify(config, null, 2));
      },
      );
      if (writeError) {
        logger.error('Failed to update package configuration:', writeError);
        return;
      }
    }

    if (config.installScript) {
      logger.debug('Running install script...');
      const [scriptError, result] = await mightFail(
        $`sh -c "cd ${packageDirectory} && (${config.installScript})"`.quiet(),
      );

      if (scriptError) {
        logger.error('Install script failed:', scriptError);
        return;
      }

      logger.warn(result?.stdout.toString());
      if (result?.stderr.length > 0) {
        logger.error('Install script error:', result.stderr.toString());
        return;
      }
    }

    // Create symlinks
    await this.createSymlinks(config.binaries, packageDirectory, options.force);

    // Update package database
    const [databaseError, database] = mightFailSync(() => this.getPackageDb());
    if (databaseError ?? !database) {
      logger.error('Failed to load package database:', databaseError);
      return;
    }

    const packageKey = source.provider ? `${source.provider}:${config.name}` : config.name;
    database[packageKey] = config;

    const [saveError] = mightFailSync(() => {
      this.savePackageDb(database);
    });
    if (saveError) {
      logger.error('Failed to save package database:', saveError);
      return;
    }

    logger.info(`Successfully installed ${packageKey}`);
  }

  async uninstall(packageName: string): Promise<void> {
    logger.warn(`Uninstalling ${packageName}`);

    const [databaseError, database] = mightFailSync(() => this.getPackageDb());
    if (databaseError ?? !database) {
      logger.error('Failed to load package database:', databaseError);
      return;
    }

    if (!database[packageName]) {
      logger.error(`Package ${packageName} not found in the database`);
      return;
    }

    const config = database[packageName];

    logger.debug('Removing symlinks...');
    for (const binary of config.binaries) {
      const binaryLink = join(this.binPath, basename(binary));
      if (existsSync(binaryLink)) {
        const [unlinkError] = mightFailSync(() => {
          unlinkSync(binaryLink);
        });
        if (unlinkError) {
          logger.error(`Failed to remove symlink for ${binary}:`, unlinkError);
          return;
        }
      }
    }

    logger.debug('Removing package directories...');
    const [rmSgoinfreError] = mightFailSync(() => {
      rmSync(join(this.sgoinfrePath, packageName), {recursive: true, force: true});
    },
    );
    if (rmSgoinfreError) {
      logger.error('Failed to remove package from sgoinfre:', rmSgoinfreError);
      return;
    }

    const [rmGoinfreError] = mightFailSync(() => {
      rmSync(join(this.goinfrePath, packageName), {recursive: true, force: true});
    },
    );
    if (rmGoinfreError) {
      logger.error('Failed to remove package from goinfre:', rmGoinfreError);
      return;
    }

    // Remove from database
    delete database[packageName]; // eslint-disable-line @typescript-eslint/no-dynamic-delete

    const [saveError] = mightFailSync(() => {
      this.savePackageDb(database);
    });
    if (saveError) {
      logger.error('Failed to save package database:', saveError);
      return;
    }

    logger.info(`Successfully uninstalled ${packageName}`);
  }

  public async list(options: {available?: boolean} = {}): Promise<void> {
    const [databaseError, database] = mightFailSync(() => this.getPackageDb());
    if (databaseError ?? !database) {
      logger.error('Failed to load package database:', databaseError);
      return;
    }

    await (options.available ? this.listAvailablePackages(database) : this.listInstalledPackages(database));
  }

  public async search(query: string): Promise<void> {
    logger.debug('Searching for packages');
    let foundAny = false;

    const [configError, config] = await mightFail(this.registryManager.getConfig());
    if (configError) {
      logger.error('Failed to load registry configuration:', configError);
      return;
    }

    // Search in each provider's directory
    for (const provider of config.providers) {
      const providerPath = join('/sgoinfre', provider);

      if (!existsSync(providerPath)) {
        continue;
      }

      const [readError, files] = mightFailSync(() => readdirSync(providerPath));
      if (readError) {
        logger.debug(`Failed to read provider directory ${provider}:`, readError);
        continue;
      }

      const matchingPackages = files.filter(name => name.includes(query));

      if (matchingPackages.length > 0) {
        foundAny = true;
        logger.info(
          `Packages available from ${provider}:\n${
            matchingPackages.map(package_ => `           - ${provider}:${package_}`).join('\n')
          }`,
        );
      }
    }

    if (!foundAny) {
      logger.warn('No packages found matching your query');
    }
  }

  public async update(packageReference: string, options: {force?: boolean} = {}): Promise<void> {
    logger.debug(`Checking for updates for ${packageReference}`);

    // Load current package database
    const [databaseError, database] = mightFailSync(() => this.getPackageDb());
    if (databaseError ?? !database) {
      logger.error('Failed to load package database:', databaseError);
      return;
    }

    // Try to parse the package reference
    const [parseError, reference] = await mightFail(async () => {
      const [configError, config] = await mightFail(this.registryManager.getConfig());
      if (configError) {
        throw configError;
      }

      return parsePackageReference(packageReference, config.defaultProvider);
    });

    if (parseError) {
      logger.error('Failed to parse package reference:', parseError);
      return;
    }

    // Create the package key as it would appear in the database
    const parsedReference = await reference();
    const packageKey = `${parsedReference.provider}:${parsedReference.name}`;
    const installedPackage = database[packageKey] ?? database[parsedReference.name];

    if (!installedPackage) {
      logger.warn(`Package ${packageReference} is not installed`);
      return;
    }

    // Get the current installed version
    const currentVersion = installedPackage.version;

    // Try to find the package source
    const [sourceError, source] = await mightFail(this.resolvePackage(packageReference));
    if (sourceError) {
      logger.error('Failed to find package source:', sourceError);
      return;
    }

    if (!source) {
      logger.error(`Package ${packageReference} not found in any source`);
      return;
    }

    // Get the new package configuration based on source type
    const [configError, newConfig] = await mightFail(async () => {
      switch (source.type) {
        case 'provider':
        case 'local': {
          const configPath = join(source.location, 'package.json');
          const [loadError, config] = await mightFail(this.loadPackageConfig(configPath));
          if (loadError ?? !config) {
            throw new Error(`Failed to load package config: ${loadError?.message}`);
          }

          return {
            ...config,
            provider: source.provider, // Preserve provider information
          };
        }

        case 'remote': {
          const [fetchError, response] = await mightFail(
            fetch(source.location.replace(/\.tar\.gz$/, '/package.json')),
          );
          if (fetchError) {
            throw new Error(`Failed to fetch remote config: ${fetchError.message}`);
          }

          if (!response.ok) {
            throw new Error(`Failed to check remote version: ${response.statusText}`);
          }

          const [parseError, data] = await mightFail(response.json());
          if (parseError) {
            throw new Error(`Failed to parse remote config: ${parseError.message}`);
          }

          const [validateError, config] = mightFailSync(() => zPackageConfig.parse(data));
          if (validateError) {
            throw new Error(`Invalid remote config format: ${validateError.message}`);
          }

          return {
            ...config,
            provider: source.provider, // Preserve provider information
          };
        }
      }
    });

    if (configError ?? !newConfig) {
      logger.error('Failed to get new package configuration:', configError);
      return;
    }

    const {version, installScript, binaries} = await newConfig();
    // Check if an update is needed
    if (version === currentVersion) {
      logger.warn(`Package ${packageReference} is already at the latest version (${currentVersion})`);
      return;
    }

    logger.info(`Updating ${packageReference} from version ${currentVersion} to ${version}`);

    // Store old binaries for cleanup
    const oldBinaries = installedPackage.binaries;

    // Determine the package directory
    const packageDirectoryName = source.provider
      ? `${source.provider}_${reference.name}`
      : reference.name;
    const packageDirectory = join(this.sgoinfrePath, packageDirectoryName);

    // Backup the old installation
    const backupDirectory = `${packageDirectory}_backup_${currentVersion}`;
    const [backupError] = mightFailSync(() => {
      if (existsSync(packageDirectory)) {
        cpSync(packageDirectory, backupDirectory, {recursive: true});
      }
    });

    if (backupError) {
      logger.error('Failed to create backup:', backupError);
      return;
    }

    // Perform the update based on source type
    const [updateError] = await mightFail(async () => {
      // Remove old installation but keep the backup
      if (existsSync(packageDirectory)) {
        rmSync(packageDirectory, {recursive: true, force: true});
      }

      switch (source.type) {
        case 'provider':
        case 'local': {
          cpSync(source.location, packageDirectory, {recursive: true});
          break;
        }

        case 'remote': {
          mkdirSync(packageDirectory, {recursive: true});
          await this.downloadPackage(source.location, packageDirectory);
          break;
        }
      }

      // Run install script if present
      if (installScript) {
        const [scriptError, result] = await mightFail(
          $`sh -c "cd ${packageDirectory} && (${installScript})"`.quiet(),
        );

        if (scriptError) {
          throw new Error(`Install script failed: ${scriptError.message}`);
        }

        if (result?.stderr.length > 0) {
          throw new Error(`Install script error: ${result.stderr.toString()}`);
        }

        logger.debug('Install script output:', result?.stdout.toString());
      }

      // Update symlinks
      await this.updateSymlinks(
        oldBinaries,
        binaries,
        packageDirectory,
        options.force,
      );

      // Update database entry
      database[packageKey] = await newConfig();
      const [saveError] = mightFailSync(() => {
        this.savePackageDb(database);
      });
      if (saveError) {
        throw new Error(`Failed to save package database: ${saveError.message}`);
      }
    });

    if (updateError) {
      logger.error('Update failed:', updateError);

      // Attempt rollback
      const [rollbackError] = await mightFail(async () => {
        logger.warn('Attempting to rollback to previous version...');

        // Restore from backup
        if (existsSync(backupDirectory)) {
          if (existsSync(packageDirectory)) {
            rmSync(packageDirectory, {recursive: true, force: true});
          }

          cpSync(backupDirectory, packageDirectory, {recursive: true});

          // Restore symlinks
          await this.updateSymlinks(
            binaries, // Remove any new symlinks
            oldBinaries, // Restore old symlinks
            packageDirectory,
            true, // Force restore
          );

          // Restore database entry
          database[packageKey] = installedPackage;
          this.savePackageDb(database);
        }
      });

      if (rollbackError) {
        logger.error('Rollback failed:', rollbackError);
        logger.error('System may be in an inconsistent state. Manual intervention required.');
      } else {
        logger.info('Successfully rolled back to previous version');
      }

      return;
    }

    // Cleanup backup on successful update
    const [cleanupError] = mightFailSync(() => {
      if (existsSync(backupDirectory)) {
        rmSync(backupDirectory, {recursive: true, force: true});
      }
    });

    if (cleanupError) {
      logger.warn('Failed to cleanup backup directory:', cleanupError);
    }

    logger.info(`Successfully updated ${packageReference} to version ${version}`);
  }

  public async updateAll(options: {force?: boolean} = {}): Promise<void> {
    logger.info('Checking for updates for all installed packages');

    const [databaseError, database] = mightFailSync(() => this.getPackageDb());
    if (databaseError ?? !database) {
      logger.error('Failed to load package database:', databaseError);
      return;
    }

    if (Object.keys(database).length === 0) {
      logger.info('No packages installed');
      return;
    }

    let hasErrors = false;
    for (const [packageKey, packageInfo] of Object.entries(database)) {
      const updateReference = packageInfo.provider
        ? `${packageInfo.provider}:${packageInfo.name}`
        : packageInfo.name;

      logger.info(`Checking ${updateReference}...`);
      const [updateError] = await mightFail(this.update(updateReference, options));

      if (updateError) {
        logger.error(`Failed to update ${updateReference}:`, updateError);
        hasErrors = true;
      }
    }

    if (hasErrors) {
      logger.warn('Some updates failed. Check the logs for details.');
    } else {
      logger.info('All packages updated successfully');
    }
  }

  public async sync(): Promise<void> {
    logger.debug('Syncing packages to goinfre');

    const [databaseError, database] = mightFailSync(() => this.getPackageDb());
    if (databaseError ?? !database) {
      logger.error('Failed to load package database:', databaseError);
      return;
    }

    // Clear and recreate goinfre directory
    const [clearError] = mightFailSync(() => {
      rmSync(this.goinfrePath, {recursive: true, force: true});
      mkdirSync(this.goinfrePath);
    });

    if (clearError) {
      logger.error('Failed to clear goinfre directory:', clearError);
      return;
    }

    // Process each package
    const syncPromises = Object.entries(database).map(async ([name, config]) => {
      logger.warn(`Syncing ${name}...`);
      const sourcePath = join(this.sgoinfrePath, name);
      const destinationPath = join(this.goinfrePath, name);

      if (!existsSync(sourcePath)) {
        logger.warn(`Source path for ${name} does not exist, skipping`);
        return;
      }

      // Copy package files
      const [copyError] = mightFailSync(() => {
        cpSync(sourcePath, destinationPath, {recursive: true});
      },
      );

      if (copyError) {
        logger.error(`Failed to copy ${name}:`, copyError);
        return;
      }

      // Process binaries
      await this.syncBinaries(config.binaries, destinationPath);
    });

    // Wait for all sync operations to complete
    const [syncError] = await mightFail(Promise.all(syncPromises));
    if (syncError) {
      logger.error('Some packages failed to sync:', syncError);
      return;
    }

    logger.info('Sync completed successfully');
  }

  /**
   * Creates symlinks for package binaries and sets appropriate permissions
   * @param binaries Array of binary paths relative to package directory
   * @param packageDirectory Full path to package directory
   * @param force Whether to force overwrite existing symlinks
   */
  private async createSymlinks(
    binaries: string[],
    packageDirectory: string,
    force = false,
  ): Promise<void> {
    logger.debug('Creating symlinks...');

    for (const binary of binaries) {
      const binaryPath = join(packageDirectory, binary);
      const binaryLink = join(this.binPath, basename(binary));

      // Ensure the binary exists in the package
      const [statError] = mightFailSync(() => existsSync(binaryPath));
      if (statError ?? !existsSync(binaryPath)) {
        logger.error(`Binary ${binary} not found in package`);
        continue;
      }

      // Check if symlink already exists
      if (existsSync(binaryLink)) {
        if (!force) {
          logger.error(`Binary ${binary} already exists. Use --force to override.`);
          continue;
        }

        // Remove existing symlink if force is true
        const [unlinkError] = mightFailSync(() => {
          unlinkSync(binaryLink);
        });
        if (unlinkError) {
          logger.error(`Failed to remove existing binary ${binary}:`, unlinkError);
          continue;
        }

        logger.debug(`Removed existing symlink for ${binary}`);
      }

      // Create the directory structure if it doesn't exist
      const linkDirectory = dirname(binaryLink);
      const [mkdirError] = mightFailSync(() => {
        if (!existsSync(linkDirectory)) {
          mkdirSync(linkDirectory, {recursive: true});
        }
      });

      if (mkdirError) {
        logger.error(`Failed to create directory for ${binary}:`, mkdirError);
        continue;
      }

      // Create new symlink and set permissions
      const [symlinkError] = mightFailSync(() => {
        // Create the symlink
        symlinkSync(binaryPath, binaryLink);

        // Set executable permissions on the actual binary
        chmodSync(binaryPath, 0o755);

        // If the symlink is in a different directory, ensure the directory is accessible
        const symlinkDirectory = dirname(binaryLink);
        if (symlinkDirectory !== this.binPath) {
          chmodSync(symlinkDirectory, 0o755);
        }
      });

      if (symlinkError) {
        logger.error(`Failed to create symlink for ${binary}:`, symlinkError);

        // Cleanup on failure
        const [cleanupError] = mightFailSync(() => {
          if (existsSync(binaryLink)) {
            unlinkSync(binaryLink);
          }
        });

        if (cleanupError) {
          logger.warn(`Failed to cleanup failed symlink for ${binary}:`, cleanupError);
        }

        continue;
      }

      logger.debug(`Successfully created symlink for ${binary}`);
    }
  }

  /**
   * Removes symlinks for package binaries
   * @param binaries Array of binary paths
   */
  private async removeSymlinks(binaries: string[]): Promise<void> {
    logger.debug('Removing symlinks...');

    for (const binary of binaries) {
      const binaryLink = join(this.binPath, basename(binary));

      if (existsSync(binaryLink)) {
        // Check if it's actually a symlink
        const [lstatError, stats] = mightFailSync(() => lstatSync(binaryLink));
        if (lstatError) {
          logger.error(`Failed to check symlink status for ${binary}:`, lstatError);
          continue;
        }

        if (!stats.isSymbolicLink()) {
          logger.warn(`${binary} exists but is not a symlink, skipping removal`);
          continue;
        }

        const [unlinkError] = mightFailSync(() => {
          unlinkSync(binaryLink);
        });
        if (unlinkError) {
          logger.error(`Failed to remove symlink for ${binary}:`, unlinkError);
          continue;
        }

        logger.debug(`Successfully removed symlink for ${binary}`);
      }

      // Try to clean up empty directories
      const linkDirectory = dirname(binaryLink);
      if (linkDirectory !== this.binPath) {
        const [readdirError, files] = mightFailSync(() => readdirSync(linkDirectory));
        if (!readdirError && files.length === 0) {
          const [rmdirError] = mightFailSync(() => {
            rmdirSync(linkDirectory);
          });
          if (rmdirError) {
            logger.warn(`Failed to remove empty directory ${linkDirectory}:`, rmdirError);
          } else {
            logger.debug(`Removed empty directory ${linkDirectory}`);
          }
        }
      }
    }
  }

  /**
   * Updates symlinks for package binaries
   * @param oldBinaries Array of old binary paths
   * @param newBinaries Array of new binary paths
   * @param packageDirectory Full path to package directory
   * @param force Whether to force overwrite existing symlinks
   */
  private async updateSymlinks(
    oldBinaries: string[],
    newBinaries: string[],
    packageDirectory: string,
    force = false,
  ): Promise<void> {
    // First remove old symlinks
    await this.removeSymlinks(oldBinaries);

    // Then create new symlinks
    await this.createSymlinks(newBinaries, packageDirectory, force);
  }

  private async resolvePackage(packageReference: string): Promise<PackageSource> {
    // First, check if it's a local path
    if (existsSync(packageReference)) {
      return {type: 'local', location: packageReference};
    }

    // Try to resolve from provider
    const [locationError, location] = await mightFail(
      this.registryManager.resolvePackageLocation(packageReference),
    );

    if (!locationError && location) {
      // Extract provider from package reference
      const [parseError, reference] = await mightFail(async () => {
        const [configError, config] = await mightFail(this.registryManager.getConfig());
        if (configError) {
          throw configError;
        }

        return parsePackageReference(packageReference, config.defaultProvider);
      });

      if (!parseError && reference) {
        const parsedReference = await reference();
        return {
          type: 'provider',
          location,
          provider: parsedReference.provider,
        };
      }
    }

    // Try to resolve from remote URL if package has one in its config
    const [configError, config] = await mightFail(this.loadPackageConfig(
      join(location ?? '', 'package.json'),
    ));

    if (!configError && config?.url) {
      return {type: 'remote', location: config.url};
    }

    throw new Error(`Unable to resolve package: ${packageReference}`);
  }

  private async listInstalledPackages(database: PackageDatabase): Promise<void> {
    if (Object.keys(database).length === 0) {
      logger.info('No packages installed');
      return;
    }

    logger.info('Installed packages:');
    for (const [packageKey, config] of Object.entries(database)) {
      const providerInfo = config.provider ? ` (from ${config.provider})` : '';
      logger.info(`           - ${packageKey}@${config.version}${providerInfo}`);
    }
  }

  private async listAvailablePackages(installedDatabase: PackageDatabase): Promise<void> {
    const [configError, config] = await mightFail(this.registryManager.getConfig());
    if (configError) {
      logger.error('Failed to load registry configuration:', configError);
      return;
    }

    const availablePackages = new Map<string, {
      provider: string;
      version?: string;
    }>();

    // Check each provider's directory
    for (const provider of config.providers) {
      const providerPath = join('/sgoinfre', provider);

      if (!existsSync(providerPath)) {
        continue;
      }

      const [readError, files] = mightFailSync(() => readdirSync(providerPath));
      if (readError) {
        logger.debug(`Failed to read provider directory ${provider}:`, readError);
        continue;
      }

      for (const packageName of files) {
        const packageKey = `${provider}:${packageName}`;

        // Skip already installed packages
        if (installedDatabase[packageKey]) {
          continue;
        }

        const configPath = join(providerPath, packageName, 'package.json');
        if (existsSync(configPath)) {
          const [loadError, config] = await mightFail(this.loadPackageConfig(configPath));
          if (loadError) {
            logger.debug(`Failed to load config for ${packageKey}:`, loadError);
            continue;
          }

          if (config) {
            availablePackages.set(packageKey, {
              provider,
              version: config.version,
            });
          }
        }
      }
    }

    if (availablePackages.size === 0) {
      logger.info('No additional packages available');
      return;
    }

    logger.info('Available packages:');
    const sortedPackages = new Map([...availablePackages.entries()].sort(([a], [b]) => a.localeCompare(b)));

    for (const [packageKey, info] of sortedPackages) {
      const versionString = info.version ? `@${info.version}` : '';
      logger.info(`           - ${packageKey}${versionString}`);
    }
  }

  private ensureDirectories(): void {
    const directories = [this.sgoinfrePath, this.goinfrePath, this.binPath];

    for (const directory of directories) {
      if (!existsSync(directory)) {
        const [mkdirError] = mightFailSync(() =>
          mkdirSync(directory, {recursive: true}),
        );
        if (mkdirError) {
          logger.error(`Failed to create directory ${directory}:`, mkdirError);
          throw mkdirError; // Constructor critical operation - must throw
        }
      }
    }

    if (!existsSync(this.packageDb)) {
      const [writeError] = mightFailSync(() => {
        writeFileSync(this.packageDb, JSON.stringify({}));
      },
      );
      if (writeError) {
        logger.error('Failed to create package database:', writeError);
        throw writeError; // Constructor critical operation - must throw
      }
    }
  }

  private getPackageDb(): PackageDatabase | undefined {
    logger.debug('Loading package database');

    const [readError, rawData] = mightFailSync(() =>
      readFileSync(this.packageDb, 'utf8'),
    );
    if (readError) {
      logger.error('Failed to read package database:', readError);
      return undefined;
    }

    const [parseError, parsedData] = mightFailSync(() =>
      JSON.parse(rawData) as unknown,
    );
    if (parseError) {
      logger.error('Failed to parse package database:', parseError);
      return undefined;
    }

    const [validationError, validatedDatabase] = mightFailSync(() =>
      zPackageDatabase.parse(parsedData),
    );
    if (validationError) {
      logger.error('Invalid package database format:', validationError);
      return undefined;
    }

    logger.debug('Package database loaded successfully');
    return validatedDatabase;
  }

  private savePackageDb(database: PackageDatabase): void {
    logger.debug('Saving package database');

    const [validationError] = mightFailSync(() =>
      zPackageDatabase.parse(database),
    );
    if (validationError) {
      logger.error('Invalid package database format:', validationError);
      return;
    }

    const [writeError] = mightFailSync(() => {
      writeFileSync(this.packageDb, JSON.stringify(database, null, 2));
    },
    );
    if (writeError) {
      logger.error('Failed to save package database:', writeError);
      return;
    }

    logger.debug('Package database saved successfully');
  }

  private async loadPackageConfig(configPath: string): Promise<PackageConfig | undefined> {
    logger.debug('Loading package configuration');

    const [readError, rawData] = mightFailSync(() =>
      readFileSync(configPath, 'utf8'),
    );
    if (readError) {
      logger.error('Failed to read package configuration:', readError);
      return undefined;
    }

    const [parseError, parsedData] = mightFailSync(() =>
      JSON.parse(rawData) as unknown,
    );
    if (parseError) {
      logger.error('Failed to parse package configuration:', parseError);
      return undefined;
    }

    const [validationError, validatedConfig] = mightFailSync(() =>
      zPackageConfig.parse(parsedData),
    );
    if (validationError) {
      logger.error('Invalid package configuration format:', validationError);
      return undefined;
    }

    logger.debug('Package configuration loaded successfully');
    return validatedConfig;
  }

  private async downloadPackage(url: string, destinationDirectory: string): Promise<void> {
    logger.debug('Downloading package');

    const [fetchError, response] = await mightFail(fetch(url));
    if (fetchError) {
      throw new Error(`Failed to fetch package: ${fetchError.message}`);
    }

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
    }

    const [bufferError, buffer] = await mightFail(response.arrayBuffer());
    if (bufferError) {
      throw new Error(`Failed to get response buffer: ${bufferError.message}`);
    }

    const temporaryFile = join(this.goinfrePath, 'temp.tar.gz');

    logger.debug('Saving package...');
    const [writeError] = mightFailSync(() => {
      writeFileSync(temporaryFile, new Uint8Array(buffer));
    });
    if (writeError) {
      throw new Error(`Failed to save package: ${writeError.message}`);
    }

    logger.debug('Extracting package...');
    const [extractError] = await mightFail(
      $`tar -xzf ${temporaryFile} -C ${destinationDirectory}`.quiet(),
    );
    if (extractError) {
      throw new Error(`Failed to extract package: ${extractError.message}`);
    }

    const [cleanupError] = mightFailSync(() => {
      unlinkSync(temporaryFile);
    });
    if (cleanupError) {
      logger.warn(`Failed to cleanup temporary file: ${cleanupError.message}`);
    }

    logger.info('Package downloaded successfully');
  }

  /**
   * Helper method to sync binary files for a package
   */
  private async syncBinaries(
    binaries: string[],
    packagePath: string,
  ): Promise<void> {
    for (const binary of binaries) {
      const binaryPath = join(packagePath, binary);
      const binaryLink = join(this.binPath, basename(binary));

      // Remove existing symlink if it exists
      if (existsSync(binaryLink)) {
        const [unlinkError] = mightFailSync(() => {
          unlinkSync(binaryLink);
        });
        if (unlinkError) {
          logger.error(`Failed to remove old symlink for ${binary}:`, unlinkError);
          continue;
        }
      }

      // Create new symlink and set permissions
      const [symlinkError] = mightFailSync(() => {
        symlinkSync(binaryPath, binaryLink);
        chmodSync(binaryPath, 0o755);
      });

      if (symlinkError) {
        logger.error(`Failed to create symlink for ${binary}:`, symlinkError);
        continue;
      }

      logger.debug(`Successfully synced binary: ${binary}`);
    }
  }
}

export {PackageManager};
