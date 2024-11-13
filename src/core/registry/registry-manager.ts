/* eslint-disable no-await-in-loop */
import {join} from 'node:path';
import {homedir} from 'node:os';
import {z} from 'zod';
import {type FileSystem} from '../../infrastructure/fs/file-system';
import {type Logger} from '../../infrastructure/logging/logger';
import {type Config} from '../../infrastructure/config/config';

// Schema definitions
const packageSchema = z.object({
  name: z.string(),
  version: z.string(),
  binaries: z.array(z.string()),
  installScript: z.string().optional(),
  url: z.string().url().optional(),
  provider: z.string().optional(),
});

const registryConfigSchema = z.object({
  providers: z.array(z.string()),
  defaultProvider: z.string().optional(),
});

export type Package = Record<string, unknown> & z.infer<typeof packageSchema>;
export type RegistryConfig = Record<string, unknown> & z.infer<typeof registryConfigSchema>;
export type PackageReference = {
  provider: string;
  name: string;
};

export class RegistryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

export class RegistryManager {
  private readonly configPath: string;
  private readonly sgoinfre: string;
  private readonly goinfre: string;
  private cachedConfig: RegistryConfig | undefined = undefined;

  constructor(
    private readonly fs: FileSystem,
    private readonly logger: Logger,
    private readonly config: Config,
  ) {
    this.configPath = join(homedir(), '.config', 'diem', 'config.json');
    this.sgoinfre = '/sgoinfre';
    this.goinfre = '/goinfre';
  }

  async initialize(): Promise<void> {
    try {
      await this.ensureConfigFile();
      await this.validatePaths();
      this.logger.info('Registry manager initialized');
    } catch (error) {
      throw new RegistryError(
        'Failed to initialize registry manager',
        'INIT_FAILED',
        error as Error,
      );
    }
  }

  async getConfig(): Promise<RegistryConfig> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    try {
      const data = await this.fs.readFile(this.configPath);
      const json: unknown = JSON.parse(data.toString());
      const config = registryConfigSchema.parse(json);
      this.cachedConfig = config;
      return config;
    } catch (error) {
      throw new RegistryError(
        'Failed to read registry configuration',
        'CONFIG_READ_ERROR',
        error as Error,
      );
    }
  }

  async addProvider(username: string): Promise<void> {
    const config = await this.getConfig();

    if (config.providers.includes(username)) {
      this.logger.warn(`Provider ${username} already exists`);
      return;
    }

    const providerPath = join(this.sgoinfre, username);
    if (!await this.fs.exists(providerPath)) {
      throw new RegistryError(
        `Provider path ${providerPath} does not exist`,
        'PROVIDER_NOT_FOUND',
      );
    }

    config.providers.push(username);
    await this.saveConfig(config);
    this.logger.info(`Added provider: ${username}`);
  }

  async removeProvider(username: string): Promise<void> {
    const config = await this.getConfig();
    const index = config.providers.indexOf(username);

    if (index === -1) {
      throw new RegistryError(
        `Provider ${username} not found`,
        'PROVIDER_NOT_FOUND',
      );
    }

    config.providers.splice(index, 1);
    if (config.defaultProvider === username) {
      config.defaultProvider = undefined;
    }

    await this.saveConfig(config);
    this.logger.info(`Removed provider: ${username}`);
  }

  async setDefaultProvider(username: string): Promise<void> {
    const config = await this.getConfig();

    if (!config.providers.includes(username)) {
      throw new RegistryError(
        `Provider ${username} not found in registry`,
        'PROVIDER_NOT_FOUND',
      );
    }

    config.defaultProvider = username;
    await this.saveConfig(config);
    this.logger.info(`Set default provider: ${username}`);
  }

  async getDefaultProvider(): Promise<string | undefined> {
    const config = await this.getConfig();
    return config.defaultProvider;
  }

  async resolvePackageLocation(reference: PackageReference): Promise<string> {
    const config = await this.getConfig();

    if (!config.providers.includes(reference.provider)) {
      throw new RegistryError(
        `Provider ${reference.provider} not found`,
        'PROVIDER_NOT_FOUND',
      );
    }

    const packagePath = join(this.sgoinfre, reference.provider, reference.name);
    if (!await this.fs.exists(packagePath)) {
      throw new RegistryError(
        `Package ${reference.name} not found in ${reference.provider}'s registry`,
        'PACKAGE_NOT_FOUND',
      );
    }

    return packagePath;
  }

  async getPackageInfo(packagePath: string): Promise<Package> {
    try {
      const configPath = join(packagePath, 'package.json');
      const data = await this.fs.readFile(configPath);
      const json: unknown = JSON.parse(data.toString());
      return packageSchema.parse(json);
    } catch (error) {
      throw new RegistryError(
        `Failed to read package info from ${packagePath}`,
        'PACKAGE_INFO_ERROR',
        error as Error,
      );
    }
  }

  async listProviders(): Promise<void> {
    const config = await this.getConfig();

    if (config.providers.length === 0) {
      this.logger.info('No providers configured');
      return;
    }

    this.logger.info('Configured providers:');
    for (const provider of config.providers) {
      const isDefault = provider === config.defaultProvider ? ' (default)' : '';
      this.logger.info(`  - ${provider}${isDefault}`);
    }
  }

  async listPackages(provider?: string): Promise<Package[]> {
    const config = await this.getConfig();
    const providers = provider ? [provider] : config.providers;
    const packages: Package[] = [];

    for (const providerName of providers) {
      const providerPath = join(this.sgoinfre, providerName);

      if (!await this.fs.exists(providerPath)) {
        continue;
      }

      try {
        const entries = await this.fs.listFiles(providerPath);

        for (const entry of entries) {
          const packagePath = join(providerPath, entry);
          const stats = await this.fs.getStats(packagePath);

          if (stats.isDirectory()) {
            try { // eslint-disable-line max-depth
              const info = await this.getPackageInfo(packagePath);
              packages.push({
                ...info,
                provider: providerName,
              });
            } catch (error) {
              this.logger.debug(`Skipping invalid package at ${packagePath}:`, error);
            }
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to read provider directory ${providerPath}:`, error);
      }
    }

    return packages;
  }

  async searchPackages(query: string): Promise<Package[]> {
    const allPackages = await this.listPackages();
    return allPackages.filter(package_ =>
      package_.name.toLowerCase().includes(query.toLowerCase()),
    );
  }

  private async ensureConfigFile(): Promise<void> {
    if (!await this.fs.exists(this.configPath)) {
      const defaultConfig: RegistryConfig = {
        providers: [],
        defaultProvider: undefined,
      };

      const configDirectory = join(homedir(), '.config', 'diem');
      await this.fs.mkdir(configDirectory, {recursive: true});
      await this.fs.writeFile(
        this.configPath,
        JSON.stringify(defaultConfig, null, 2),
      );
    }
  }

  private async saveConfig(config: RegistryConfig): Promise<void> {
    try {
      await this.fs.writeFile(
        this.configPath,
        JSON.stringify(config, null, 2),
      );
      this.cachedConfig = config;
    } catch (error) {
      throw new RegistryError(
        'Failed to save registry configuration',
        'CONFIG_WRITE_ERROR',
        error as Error,
      );
    }
  }

  private async validatePaths(): Promise<void> {
    const paths = [this.sgoinfre, this.goinfre];

    for (const path of paths) {
      if (!await this.fs.exists(path)) {
        throw new RegistryError(
          `Required path ${path} does not exist`,
          'PATH_NOT_FOUND',
        );
      }
    }
  }
}

// Helper function to parse package references
export function parsePackageReference(
  reference: string,
  defaultProvider?: string,
): PackageReference {
  const parts = reference.split(':');

  if (parts.length === 2) {
    return {provider: parts[0], name: parts[1]};
  }

  if (!defaultProvider) {
    throw new RegistryError(
      'No provider specified and no default provider configured',
      'NO_PROVIDER',
    );
  }

  return {provider: defaultProvider, name: reference};
}

// Utility function to normalize package names
export function normalizePackageName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z\d-]/g, '-');
}
