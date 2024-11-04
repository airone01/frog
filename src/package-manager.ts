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

      logger.info('Creating symlinks...');
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
    logger.info('Syncing packages to goinfre');
    const database = this.getPackageDb();

    if (database === undefined) {
      throw new Error('Failed to load package database');
    }

    try {
      logger.info('Clearing goinfre directory...');
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

      logger.info('Removing symlinks...');
      for (const binary of config.binaries) {
        const binaryLink = join(this.binPath, basename(binary));
        if (existsSync(binaryLink)) {
          unlinkSync(binaryLink);
        }
      }

      logger.info('Removing package directories...');
      rmSync(join(this.sgoinfrePath, packageName), {recursive: true, force: true});
      rmSync(join(this.goinfrePath, packageName), {recursive: true, force: true});

      delete database[packageName]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
      this.savePackageDb(database);

      logger.info(`Successfully uninstalled ${packageName}`);
    } catch (error) {
      logger.error('Uninstall failed', error);
    }
  }

  async list(): Promise<void> {
    logger.debug('Loading installed packages');

    try {
      const database = this.getPackageDb();

      if (database === undefined) {
        throw new Error('Failed to load package database');
      }

      if (Object.keys(database).length === 0) {
        logger.info('No packages installed');
        return;
      }

      logger.info(`Installed packages:\n${Object.entries(database).map(([name, config]) => `           - ${name}@${config.version}`).join(', ')}`);
    } catch (error) {
      logger.error('Failed to list packages', error);
    }
  }

  async search(query: string): Promise<void> {
    logger.info('Searching for packages');
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
        logger.info('No packages found matching your query');
      }
    } catch (error) {
      logger.error('Search failed', error);
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
    logger.info('Saving package database');
    try {
      // Validate before saving
      zPackageDatabase.parse(database);
      writeFileSync(this.packageDb, JSON.stringify(database, null, 2));
      logger.info('Package database saved successfully');
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
      logger.info('Package found in local path');
      return {type: 'local', location: packageName};
    }

    // Check if package has a remote URL in registry
    const registry = await this.loadRegistry();
    if (registry?.[packageName]?.url) {
      logger.info('Package found in remote registry');
      return {type: 'remote', location: registry[packageName].url};
    }

    logger.error('Package not found in any source');
    return undefined;
  }

  private async downloadPackage(url: string, destinationDirectory: string): Promise<void> {
    logger.info('Downloading package');

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const temporaryFile = join(this.goinfrePath, 'temp.tar.gz');

      logger.info('Saving package...');
      writeFileSync(temporaryFile, Buffer.from(buffer));

      logger.info('Extracting package...');
      await $`tar -xzf ${temporaryFile} -C ${destinationDirectory}`.quiet();
      unlinkSync(temporaryFile);

      logger.info('Package downloaded and extracted successfully');
    } catch (error) {
      logger.error('Download failed', error);
    }
  }
}

export {PackageManager};
