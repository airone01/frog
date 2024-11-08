import {join, basename} from 'node:path';
import {homedir, userInfo} from 'node:os';
import {
  chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import {z} from 'zod';
import {$} from 'bun';
import {mightFail, mightFailSync} from '@might/fail';
import {logger} from './logger';

// Zod schemas
const zPackageConfig = z.object({
  name: z.string(),
  version: z.string(),
  binaries: z.array(z.string()),
  installScript: z.string().optional(),
  url: z.string().url().optional(),
});

const zPackageDatabase = z.record(z.string(), zPackageConfig);

const zRegistry = z.record(z.string(), z.object({
  url: z.string().url(),
}));

type PackageConfig = z.infer<typeof zPackageConfig>;
type PackageDatabase = z.infer<typeof zPackageDatabase>;

type PackageSource = {
  type: 'local' | 'shared' | 'remote';
  location: string;
};

class PackageManager {
  private readonly homePath: string;
  private readonly sgoinfrePath: string;
  private readonly goinfrePath: string;
  private readonly binPath: string;
  private readonly packageDb: string;
  private readonly sharedPackages: string;
  private readonly username: string;

  constructor() {
    this.homePath = homedir();
    this.username = userInfo().username;
    this.sgoinfrePath = join('/sgoinfre', this.username, 'packages');
    this.goinfrePath = join('/goinfre', this.username, 'packages');
    this.binPath = join(this.homePath, 'bin');
    this.packageDb = join(this.sgoinfrePath, 'package-db.json');
    this.sharedPackages = '/sgoinfre/frog';

    this.ensureDirectories();
  }

  async install(packageName: string, options: {force?: boolean} = {}): Promise<void> { // eslint-disable-line complexity
    logger.info(`Installing package '${packageName}'`);

    const [sourceError, source] = await mightFail(this.findPackageSource(packageName));
    if (sourceError) {
      logger.error('Failed to find package source:', sourceError);
      return;
    }

    if (!source) {
      logger.error(`Package ${packageName} not found in any source`);
      return;
    }

    let packageDirectory: string;

    switch (source.type) {
      case 'shared': {
        logger.debug('Copying from shared directory...');
        packageDirectory = join(this.sgoinfrePath, basename(packageName));
        const [copyError] = mightFailSync(() => {
          cpSync(source.location, packageDirectory, {recursive: true});
        });
        if (copyError) {
          logger.error('Failed to copy from shared directory:', copyError);
          return;
        }

        break;
      }

      case 'local': {
        logger.debug('Copying from local path...');
        packageDirectory = join(this.sgoinfrePath, basename(packageName));
        const [copyError] = mightFailSync(() => {
          cpSync(source.location, packageDirectory, {recursive: true});
        });
        if (copyError) {
          logger.error('Failed to copy from local path:', copyError);
          return;
        }

        break;
      }

      case 'remote': {
        logger.debug('Preparing for download...');
        packageDirectory = join(this.sgoinfrePath, packageName);
        const [mkdirError] = mightFailSync(() => mkdirSync(packageDirectory, {recursive: true}));
        if (mkdirError) {
          logger.error('Failed to create package directory:', mkdirError);
          return;
        }

        const [downloadError] = await mightFail(this.downloadPackage(source.location, packageDirectory));
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

    if (config.installScript) {
      logger.debug('Running install script...');
      const [scriptError, shell] = await mightFail(
        $`sh -c "cd ${packageDirectory} && (${config.installScript})"`.quiet(),
      );

      if (scriptError) {
        logger.error('Install script failed:', scriptError);
        return;
      }

      const {stdout, stderr} = shell;
      logger.warn(stdout.toString());
      if (stderr.length > 0) {
        logger.error('Install script error:', stderr.toString());
        return;
      }
    }

    logger.debug('Creating symlinks...');
    for (const binary of config.binaries) {
      const binaryPath = join(packageDirectory, binary);
      const binaryLink = join(this.binPath, basename(binary));

      if (existsSync(binaryLink)) {
        if (!options.force) {
          logger.error(`Binary ${binary} already exists. Use --force to override.`);
          return;
        }

        const [unlinkError] = mightFailSync(() => {
          unlinkSync(binaryLink);
        });
        if (unlinkError) {
          logger.error(`Failed to remove existing binary ${binary}:`, unlinkError);
          return;
        }
      }

      const [symlinkError] = mightFailSync(() => {
        symlinkSync(binaryPath, binaryLink);
        chmodSync(binaryLink, 0o755);
      });

      if (symlinkError) {
        logger.error(`Failed to create symlink for ${binary}:`, symlinkError);
        return;
      }
    }

    const [databaseError, database] = mightFailSync(() => this.getPackageDb());
    if (databaseError ?? !database) {
      logger.error('Failed to load package database:', databaseError);
      return;
    }

    database[config.name] = config;
    const [saveError] = mightFailSync(() => {
      this.savePackageDb(database);
    });
    if (saveError) {
      logger.error('Failed to save package database:', saveError);
      return;
    }

    logger.info(`Successfully installed ${config.name}`);
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

  async list(options: {available?: boolean} = {}): Promise<void> {
    logger.debug('Loading package information');

    const [databaseError, database] = mightFailSync(this.getPackageDb);
    if (databaseError) {
      logger.error('Failed to list packages', databaseError);
      return;
    }

    if (!database) {
      logger.warn('No packages found (this or there was an error fetching the database)');
      return;
    }

    await (options.available ? this.listAvailablePackages(database) : this.listInstalledPackages(database));
  }

  async search(query: string): Promise<void> {
    logger.debug('Searching for packages');
    let foundAny = false;

    // Search in shared directory
    if (existsSync(this.sharedPackages)) {
      const [readDirectoryError, sharedFiles] = mightFailSync(() =>
        readdirSync(this.sharedPackages),
      );

      if (readDirectoryError) {
        logger.error('Failed to read shared packages directory:', readDirectoryError);
        return;
      }

      const sharedPackages = sharedFiles.filter(name => name.includes(query));

      if (sharedPackages.length > 0) {
        foundAny = true;
        logger.info(
          `Packages available in shared directory:\n${
            sharedPackages.map(element => `           - ${element}`).join(', ')
          }`,
        );
      }
    }

    // Search in registry
    const registryPath = join(this.sharedPackages, 'registry.json');
    if (existsSync(registryPath)) {
      const [readError, fileContent] = mightFailSync(() =>
        readFileSync(registryPath, 'utf8'),
      );

      if (readError) {
        logger.error('Failed to read registry file:', readError);
        return;
      }

      const [parseError, registry] = mightFailSync(() =>
        JSON.parse(fileContent) as Record<string, unknown>,
      );

      if (parseError) {
        logger.error('Failed to parse registry JSON:', parseError);
        return;
      }

      const [validateError, validRegistry] = mightFailSync(() =>
        zRegistry.parse(registry),
      );

      if (validateError) {
        logger.error('Invalid registry format:', validateError);
        return;
      }

      const remotePackages = Object.keys(validRegistry)
        .filter(name => name.includes(query));

      if (remotePackages.length > 0) {
        foundAny = true;
        logger.info(
          `Packages available remotely:\n${
            remotePackages.map(element => `           - ${element}`).join(', ')
          }`,
        );
      }
    }

    if (!foundAny) {
      logger.warn('No packages found matching your query');
    }
  }

  async update(packageName: string, options: {force?: boolean} = {}): Promise<void> {
    logger.debug(`Checking for updates for ${packageName}`);

    const [databaseError, database] = mightFailSync(() => this.getPackageDb());
    if (databaseError ?? !database) {
      logger.error('Failed to load package database:', databaseError);
      return;
    }

    if (!database[packageName]) {
      logger.warn(`Package ${packageName} is not installed`);
      return;
    }

    const currentVersion = database[packageName].version;

    const [sourceError, source] = await mightFail(this.findPackageSource(packageName));
    if (sourceError) {
      logger.error('Failed to find package source:', sourceError);
      return;
    }

    if (!source) {
      logger.error(`Package ${packageName} not found in any source`);
      return;
    }

    // Get new package configuration based on source type
    const [configError, newConfig] = await mightFail(async () => {
      switch (source.type) {
        case 'shared':
        case 'local': {
          const configPath = join(source.location, 'package.json');
          const [loadError, config] = await mightFail(this.loadPackageConfig(configPath));
          if (loadError ?? !config) {
            throw new Error(`Failed to load package config: ${loadError?.message}`);
          }

          return config;
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

          return config;
        }
      }
    });

    if (configError ?? !newConfig) {
      logger.error('Failed to get new package configuration:', configError);
      return;
    }

    const {version} = await newConfig();

    if (version === currentVersion) {
      logger.warn(`Package ${packageName} is already at the latest version (${currentVersion})`);
      return;
    }

    logger.info(`Updating ${packageName} from version ${currentVersion} to ${version}`);

    // Uninstall the old version
    const [uninstallError] = await mightFail(this.uninstall(packageName));
    if (uninstallError) {
      logger.error(`Failed to uninstall old version: ${uninstallError.message}`);
      return;
    }

    // Install the new version
    const [installError] = await mightFail(this.install(packageName, options));
    if (installError) {
      logger.error(`Failed to install new version: ${installError.message}`);
      // Try to rollback by reinstalling the old version
      const [rollbackError] = await mightFail(this.install(packageName, {force: true}));
      if (rollbackError) {
        logger.error(`Failed to rollback to previous version: ${rollbackError.message}`);
      }

      return;
    }

    logger.info(`Successfully updated ${packageName} to version ${version}`);
  }

  async updateAll(options: {force?: boolean} = {}): Promise<void> {
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

    const updatePromises = Object.keys(database).map(async packageName => {
      const [updateError] = await mightFail(this.update(packageName, options));
      if (updateError) {
        logger.error(`Failed to update ${packageName}:`, updateError);
      }
    });

    const [allUpdatesError] = await mightFail(Promise.all(updatePromises));
    if (allUpdatesError) {
      logger.error('Some updates failed:', allUpdatesError);
      return;
    }

    logger.debug('Finished checking for updates');
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

  private async listInstalledPackages(database: PackageDatabase): Promise<void> {
    if (Object.keys(database).length === 0) {
      logger.info('No packages installed');
      return;
    }

    logger.info('Installed packages:');
    for (const [name, config] of Object.entries(database)) {
      logger.info(`           - ${name}@${config.version}`);
    }
  }

  private async listAvailablePackages(installedDatabase: PackageDatabase): Promise<void> { // eslint-disable-line complexity
    logger.debug('Searching for available packages...');
    const availablePackages = new Map<string, {
      source: string;
      version?: string;
    }>();

    // Check shared directory
    if (existsSync(this.sharedPackages)) {
      const [readError, packages] = mightFailSync(() =>
        readdirSync(this.sharedPackages),
      );

      if (readError) {
        logger.error('Failed to read shared packages directory:', readError);
        return;
      }

      for (const packageName of packages) {
        // Skip registry file and already installed packages
        if (packageName === 'registry.json' || installedDatabase[packageName]) {
          continue;
        }

        const configPath = join(this.sharedPackages, packageName, 'package.json');
        if (existsSync(configPath)) {
          const [loadError, config] = await mightFail(this.loadPackageConfig(configPath)); // eslint-disable-line no-await-in-loop
          if (loadError) {
            logger.debug(`Failed to load config for ${packageName} in shared directory:`, loadError);
            continue;
          }

          if (config) {
            availablePackages.set(packageName, {
              source: 'shared',
              version: config.version,
            });
          }
        }
      }
    }

    // Check registry
    const [registryError, registry] = await mightFail(this.loadRegistry());
    if (registryError) {
      logger.debug('Failed to load registry:', registryError);
    } else if (registry) {
      for (const [packageName, packageInfo] of Object.entries(registry)) {
        // Skip already installed packages
        if (installedDatabase[packageName]) {
          continue;
        }

        const [fetchError, response] = await mightFail( // eslint-disable-line no-await-in-loop
          fetch(packageInfo.url.replace(/\.tar\.gz$/, '/package.json')),
        );
        if (fetchError) {
          logger.debug(`Failed to fetch remote package ${packageName}:`, fetchError);
          continue;
        }

        if (!response.ok) {
          logger.debug(`Failed to fetch version for remote package ${packageName}: ${response.statusText}`);
          continue;
        }

        const [jsonError, data] = await mightFail(response.json()); // eslint-disable-line no-await-in-loop
        if (jsonError) {
          logger.debug(`Failed to parse JSON for remote package ${packageName}:`, jsonError);
          continue;
        }

        const [validationError, config] = mightFailSync(() => zPackageConfig.safeParse(data));
        if (!validationError && config.success) {
          availablePackages.set(packageName, {
            source: 'remote',
            version: config.data.version,
          });
        } else {
          logger.debug(`Invalid package config for remote package ${packageName}`);
        }
      }
    }

    if (availablePackages.size === 0) {
      logger.debug('No additional packages available');
      return;
    }

    logger.info('Available packages:');
    const sortedAvailablePackages = new Map(
      [...availablePackages.entries()].sort(([nameA], [nameB]) =>
        nameA.localeCompare(nameB),
      ),
    );

    for (const [name, info] of sortedAvailablePackages) {
      const versionString = info.version ? `@${info.version}` : '';
      const sourceString = `(${info.source})`;
      logger.info(`           - ${name}${versionString} ${sourceString}`);
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

  private async findPackageSource(packageName: string): Promise<PackageSource | undefined> {
    logger.debug('Searching for package source');

    // Check shared directory first
    const sharedPath = join(this.sharedPackages, packageName);
    if (existsSync(sharedPath)) {
      const [statError] = mightFailSync(() =>
        // Additional validation could be done here
        true,
      );
      if (!statError) {
        logger.debug('Package found in shared directory');
        return {type: 'shared', location: sharedPath};
      }
    }

    // Check if it's a local path
    if (existsSync(packageName)) {
      const [statError] = mightFailSync(() =>
        // Additional validation could be done here
        true,
      );
      if (!statError) {
        logger.debug('Package found in local path');
        return {type: 'local', location: packageName};
      }
    }

    // Check if package has a remote URL in registry
    const [registryError, registry] = await mightFail(this.loadRegistry());
    if (registryError) {
      logger.debug('Failed to load registry:', registryError);
      return undefined;
    }

    if (registry?.[packageName]?.url) {
      // Validate the URL
      const [validateError] = mightFailSync(() => {
        z.string().url().parse(registry[packageName].url); // Will throw if invalid
        return true;
      });

      if (!validateError) {
        logger.debug('Package found in remote registry');
        return {type: 'remote', location: registry[packageName].url};
      }

      logger.error('Invalid URL in registry for package:', packageName);
    }

    logger.error('Package not found in any source');
    return undefined;
  }

  private async loadRegistry(): Promise<z.infer<typeof zRegistry> | undefined> {
    const registryPath = join(this.sharedPackages, 'registry.json');
    if (!existsSync(registryPath)) {
      return undefined;
    }

    const [readError, rawData] = mightFailSync(() =>
      readFileSync(registryPath, 'utf8'),
    );
    if (readError) {
      throw new Error(`Failed to read registry file: ${readError.message}`);
    }

    const [parseError, parsedData] = mightFailSync(() =>
      JSON.parse(rawData) as unknown,
    );
    if (parseError) {
      throw new Error(`Failed to parse registry JSON: ${parseError.message}`);
    }

    const [validationError, registry] = mightFailSync(() =>
      zRegistry.parse(parsedData),
    );
    if (validationError) {
      throw new Error(`Invalid registry format: ${validationError.message}`);
    }

    return registry;
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
      writeFileSync(temporaryFile, Buffer.from(buffer));
    },
    );
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
