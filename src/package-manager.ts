import {
  chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import {join, basename} from 'node:path';
import {homedir, userInfo} from 'node:os';
import {z} from 'zod';
import {$} from 'bun';
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

  async install(packageName: string, options: {force?: boolean} = {}): Promise<void> {
    const source = await this.findPackageSource(packageName);

    if (!source) {
      throw new Error(`Package ${packageName} not found in any source`);
    }

    let packageDirectory: string;
    let configPath: string;

    logger.info(`Installing package '${packageName}'`);

    try {
      switch (source.type) {
        case 'shared': {
          logger.debug('Copying from shared directory...');
          packageDirectory = join(this.sgoinfrePath, basename(packageName));
          cpSync(source.location, packageDirectory, {recursive: true});
          break;
        }

        case 'local': {
          logger.debug('Copying from local path...');
          packageDirectory = join(this.sgoinfrePath, basename(packageName));
          cpSync(source.location, packageDirectory, {recursive: true});
          break;
        }

        case 'remote': {
          logger.debug('Preparing for download...');
          packageDirectory = join(this.sgoinfrePath, packageName);
          mkdirSync(packageDirectory, {recursive: true});
          await this.downloadPackage(source.location, packageDirectory);
          break;
        }
      }

      configPath = join(packageDirectory, 'package.json');
      const config = await this.loadPackageConfig(configPath);

      if (config === undefined) {
        throw new Error('Problem while loading package configuration');
      }

      if (config.installScript) {
        logger.debug('Running install script...');
        const {stdout, stderr} = await $`sh -c "cd ${packageDirectory} && (${config.installScript})"`.quiet();

        logger.warn(stdout.toString());
        if (stderr.length > 0) {
          throw new Error(stderr.toString());
        }
      }

      logger.debug('Creating symlinks...');
      for (const binary of config.binaries) {
        const binaryPath = join(packageDirectory, binary);
        const binaryLink = join(this.binPath, basename(binary));

        if (existsSync(binaryLink)) {
          if (!options.force) {
            throw new Error(`Binary ${binary} already exists. Use --force to override.`);
          }

          unlinkSync(binaryLink);
        }

        symlinkSync(binaryPath, binaryLink);
        chmodSync(binaryLink, 0o755);
      }

      const database = this.getPackageDb();
      if (database === undefined) {
        throw new Error('Failed to load package database');
      }

      database[config.name] = config;
      this.savePackageDb(database);

      logger.info(`Successfully installed ${config.name}`);
    } catch (error) {
      logger.error('Installation failed', error);
    }
  }

  async sync(): Promise<void> {
    logger.debug('Syncing packages to goinfre');
    const database = this.getPackageDb();

    if (database === undefined) {
      throw new Error('Failed to load package database');
    }

    try {
      logger.debug('Clearing goinfre directory...');
      rmSync(this.goinfrePath, {recursive: true, force: true});
      mkdirSync(this.goinfrePath);

      for (const [name, config] of Object.entries(database)) {
        logger.warn(`Syncing ${name}...`);
        const sourcePath = join(this.sgoinfrePath, name);
        const destinationPath = join(this.goinfrePath, name);

        if (existsSync(sourcePath)) {
          cpSync(sourcePath, destinationPath, {recursive: true});

          for (const binary of config.binaries) {
            const binaryPath = join(destinationPath, binary);
            const binaryLink = join(this.binPath, basename(binary));

            // eslint-disable-next-line max-depth
            if (existsSync(binaryLink)) {
              unlinkSync(binaryLink);
            }

            symlinkSync(binaryPath, binaryLink);
            chmodSync(binaryPath, 0o755);
          }
        }
      }

      logger.info('Sync completed successfully');
    } catch (error) {
      logger.error('Sync failed', error);
    }
  }

  async uninstall(packageName: string): Promise<void> {
    logger.warn(`Uninstalling ${packageName}`);
    const database = this.getPackageDb();

    if (database === undefined) {
      throw new Error('Failed to load package database');
    }

    try {
      if (!database[packageName]) {
        throw new Error(`Package ${packageName} not found`);
      }

      const config = database[packageName];

      logger.debug('Removing symlinks...');
      for (const binary of config.binaries) {
        const binaryLink = join(this.binPath, basename(binary));
        if (existsSync(binaryLink)) {
          unlinkSync(binaryLink);
        }
      }

      logger.debug('Removing package directories...');
      rmSync(join(this.sgoinfrePath, packageName), {recursive: true, force: true});
      rmSync(join(this.goinfrePath, packageName), {recursive: true, force: true});

      delete database[packageName]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
      this.savePackageDb(database);

      logger.info(`Successfully uninstalled ${packageName}`);
    } catch (error) {
      logger.error('Uninstall failed', error);
    }
  }

  // Then update the list method in the PackageManager class:
  async list(options: {available?: boolean} = {}): Promise<void> {
    logger.debug('Loading package information');

    try {
      const database = this.getPackageDb();

      if (database === undefined) {
        throw new Error('Failed to load package database');
      }

      await (options.available ? this.listAvailablePackages(database) : this.listInstalledPackages(database));
    } catch (error) {
      logger.error('Failed to list packages', error);
      throw error;
    }
  }

  async search(query: string): Promise<void> {
    logger.debug('Searching for packages');
    let foundAny = false;

    try {
      // Search in shared directory
      if (existsSync(this.sharedPackages)) {
        const sharedPackages = readdirSync(this.sharedPackages)
          .filter(name => name.includes(query));

        if (sharedPackages.length > 0) {
          foundAny = true;
          logger.info(`Packages available in shared directory:\n${sharedPackages.map(element => `           - ${element}`).join(', ')}`);
        }
      }

      // Search in registry
      const registryPath = join(this.sharedPackages, 'registry.json');
      if (existsSync(registryPath)) {
        const file = readFileSync(registryPath, 'utf8');
        const registry: Record<string, unknown> = JSON.parse(file) as Record<string, unknown>;
        const remotePackages = Object.keys(registry)
          .filter(name => name.includes(query));

        if (remotePackages.length > 0) {
          foundAny = true;
          logger.info(`Packages available remotely:\n${remotePackages.map(element => `           - ${element}`).join(', ')}`);
        }
      }

      if (!foundAny) {
        logger.warn('No packages found matching your query');
      }
    } catch (error) {
      logger.error('Search failed', error);
    }
  }

  async update(packageName: string, options: {force?: boolean} = {}): Promise<void> {
    logger.debug(`Checking for updates for ${packageName}`);
    const database = this.getPackageDb();

    if (database === undefined) {
      throw new Error('Failed to load package database');
    }

    try {
      if (!database[packageName]) {
        logger.warn(`Package ${packageName} is not installed`);
        return;
      }

      const currentVersion = database[packageName].version;
      const source = await this.findPackageSource(packageName);

      if (!source) {
        logger.error(`Package ${packageName} not found in any source`);
        return;
      }

      let newConfig: PackageConfig | undefined;

      switch (source.type) {
        case 'shared': {
          const configPath = join(source.location, 'package.json');
          newConfig = await this.loadPackageConfig(configPath);
          break;
        }

        case 'local': {
          const configPath = join(source.location, 'package.json');
          newConfig = await this.loadPackageConfig(configPath);
          break;
        }

        case 'remote': {
          // For remote packages, we need to check the version without downloading
          const response = await fetch(source.location.replace(/\.tar\.gz$/, '/package.json'));
          if (!response.ok) {
            throw new Error(`Failed to check remote version: ${response.statusText}`);
          }

          const data: unknown = await response.json();
          newConfig = zPackageConfig.parse(data);
          break;
        }
      }

      if (!newConfig) {
        throw new Error('Failed to load new package configuration');
      }

      if (newConfig.version === currentVersion) {
        logger.warn(`Package ${packageName} is already at the latest version (${currentVersion})`);
        return;
      }

      logger.info(`Updating ${packageName} from version ${currentVersion} to ${newConfig.version}`);

      // Uninstall the old version
      await this.uninstall(packageName);

      // Install the new version
      await this.install(packageName, options);

      logger.info(`Successfully updated ${packageName} to version ${newConfig.version}`);
    } catch (error) {
      logger.error(`Failed to update ${packageName}`, error);
      throw error;
    }
  }

  async updateAll(options: {force?: boolean} = {}): Promise<void> {
    logger.info('Checking for updates for all installed packages');
    const database = this.getPackageDb();

    if (database === undefined) {
      throw new Error('Failed to load package database');
    }

    if (Object.keys(database).length === 0) {
      logger.info('No packages installed');
      return;
    }

    const updatePromises = Object.keys(database).map(async packageName => {
      try {
        await this.update(packageName, options);
      } catch (error) {
        logger.error(`Failed to update ${packageName}`, error);
      }
    });

    await Promise.all(updatePromises);
    logger.debug('Finished checking for updates');
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

  private async listAvailablePackages(installedDatabase: PackageDatabase): Promise<void> {
    logger.debug('Searching for available packages...');
    const availablePackages = new Map<string, {
      source: string;
      version?: string;
    }>();

    // Check shared directory
    if (existsSync(this.sharedPackages)) {
      for (const packageName of readdirSync(this.sharedPackages)) {
        if (packageName === 'registry.json' || installedDatabase[packageName]) {
          continue;
        }

        const configPath = join(this.sharedPackages, packageName, 'package.json');
        if (existsSync(configPath)) {
          try {
            const config = await this.loadPackageConfig(configPath); // eslint-disable-line no-await-in-loop
            if (config) { // eslint-disable-line max-depth
              availablePackages.set(packageName, {
                source: 'shared',
                version: config.version,
              });
            }
          } catch {
            logger.debug(`Failed to load config for ${packageName} in shared directory`);
          }
        }
      }
    }

    // Check registry
    const registry = await this.loadRegistry();
    if (registry) {
      for (const [packageName, packageInfo] of Object.entries(registry)) {
        if (installedDatabase[packageName]) {
          continue;
        }

        try {
          const response = await fetch(packageInfo.url.replace(/\.tar\.gz$/, '/package.json')); // eslint-disable-line no-await-in-loop
          if (response.ok) {
            const data: unknown = await response.json(); // eslint-disable-line no-await-in-loop
            const config = zPackageConfig.safeParse(data);
            if (config.success) { // eslint-disable-line max-depth
              availablePackages.set(packageName, {
                source: 'remote',
                version: config.data.version,
              });
            }
          }
        } catch {
          logger.debug(`Failed to fetch version for remote package ${packageName}`);
        }
      }
    }

    if (availablePackages.size === 0) {
      logger.debug('No additional packages available');
      return;
    }

    logger.info('Available packages:');
    const sortedAvailablePackages = new Map([...availablePackages.entries()].sort(([nameA], [nameB]) => nameA.localeCompare(nameB)));
    for (const [name, info] of sortedAvailablePackages) {
      const versionString = info.version ? `@${info.version}` : '';
      const sourceString = `(${info.source})`;
      logger.info(`           - ${name}${versionString} ${sourceString}`);
    }
  }

  private ensureDirectories(): void {
    for (const directory of [this.sgoinfrePath, this.goinfrePath, this.binPath]) {
      if (!existsSync(directory)) {
        mkdirSync(directory, {recursive: true});
      }
    }

    if (!existsSync(this.packageDb)) {
      writeFileSync(this.packageDb, JSON.stringify({}));
    }
  }

  private getPackageDb(): PackageDatabase | undefined {
    logger.debug('Loading package database');
    try {
      const rawData = readFileSync(this.packageDb, 'utf8');
      const parsedData: unknown = JSON.parse(rawData);
      const validatedDatabase = zPackageDatabase.parse(parsedData);
      logger.debug('Package database loaded successfully');
      return validatedDatabase;
    } catch (error) {
      logger.error('Invalid package database format', error);
    }
  }

  private savePackageDb(database: PackageDatabase): void {
    logger.debug('Saving package database');
    try {
      // Validate before saving
      zPackageDatabase.parse(database);
      writeFileSync(this.packageDb, JSON.stringify(database, null, 2));
      logger.debug('Package database saved successfully');
    } catch (error) {
      logger.error('Invalid package database format', error);
    }
  }

  private async loadPackageConfig(configPath: string): Promise<PackageConfig | undefined> {
    logger.debug('Loading package configuration');
    try {
      const rawData = readFileSync(configPath, 'utf8');
      const parsedData: unknown = JSON.parse(rawData);
      const validatedConfig = zPackageConfig.parse(parsedData);
      logger.debug('Package configuration loaded successfully');
      return validatedConfig;
    } catch (error) {
      logger.error('Invalid package configuration format', error);
    }
  }

  private async loadRegistry(): Promise<z.infer<typeof zRegistry> | undefined> {
    const registryPath = join(this.sharedPackages, 'registry.json');
    if (!existsSync(registryPath)) {
      return undefined;
    }

    try {
      const rawData = readFileSync(registryPath, 'utf8');
      const parsedData: unknown = JSON.parse(rawData);
      return zRegistry.parse(parsedData);
    } catch (error) {
      console.error('Invalid registry format:', error);

      return undefined;
    }
  }

  private async findPackageSource(packageName: string): Promise<PackageSource | undefined> {
    logger.debug('Searching for package source');

    // Check shared directory first
    const sharedPath = join(this.sharedPackages, packageName);
    if (existsSync(sharedPath)) {
      logger.debug('Package found in shared directory');
      return {type: 'shared', location: sharedPath};
    }

    // Check if it's a local path
    if (existsSync(packageName)) {
      logger.debug('Package found in local path');
      return {type: 'local', location: packageName};
    }

    // Check if package has a remote URL in registry
    const registry = await this.loadRegistry();
    if (registry?.[packageName]?.url) {
      logger.debug('Package found in remote registry');
      return {type: 'remote', location: registry[packageName].url};
    }

    logger.error('Package not found in any source');
    return undefined;
  }

  private async downloadPackage(url: string, destinationDirectory: string): Promise<void> {
    logger.debug('Downloading package');

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const temporaryFile = join(this.goinfrePath, 'temp.tar.gz');

      logger.debug('Saving package...');
      writeFileSync(temporaryFile, Buffer.from(buffer));

      logger.debug('Extracting package...');
      await $`tar -xzf ${temporaryFile} -C ${destinationDirectory}`.quiet();
      unlinkSync(temporaryFile);

      logger.info('Package installed successfully');
    } catch (error) {
      logger.error('Download failed', error);
    }
  }
}

export {PackageManager};
