import {join} from 'node:path';
import {homedir} from 'node:os';
import {z} from 'zod';
import {env} from 'bun';
import {type FileSystem} from '../fs/file-system';
import {type Logger} from '../logging/logger';

// Configuration schema
const configSchema = z.object({
  packageRoot: z.string(),
  binariesPath: z.string(),
  tempDir: z.string(),
  goinfre: z.string(),
  sgoinfre: z.string(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  registryConfig: z.object({
    providers: z.array(z.string()),
    defaultProvider: z.string().optional(),
  }),
});

type ConfigData = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class Config {
  private data!: ConfigData;
  private readonly configPath: string;

  constructor(
    private readonly fs: FileSystem,
    private readonly logger: Logger,
    customConfigPath?: string,
  ) {
    this.configPath = customConfigPath ?? join(homedir(), '.config', 'diem', 'config.json');
  }

  async initialize(): Promise<void> {
    try {
      await this.loadConfig();
    } catch (error) {
      if (error instanceof ConfigError && error.code === 'CONFIG_NOT_FOUND') {
        await this.createDefaultConfig();
      } else {
        throw error;
      }
    }
  }

  get packageRoot(): string {
    return this.data.packageRoot;
  }

  get binariesPath(): string {
    return this.data.binariesPath;
  }

  get tempDir(): string {
    return this.data.tempDir;
  }

  get goinfre(): string {
    return this.data.goinfre;
  }

  get sgoinfre(): string {
    return this.data.sgoinfre;
  }

  get logLevel(): string {
    return this.data.logLevel;
  }

  get registryConfig(): {providers: string[]; defaultProvider?: string} {
    return this.data.registryConfig;
  }

  async update(updates: Partial<ConfigData>): Promise<void> {
    try {
      const newConfig = {...this.data, ...updates};
      const parseResult = configSchema.safeParse(newConfig);

      if (!parseResult.success) {
        throw new ConfigError(
          `Invalid configuration update: ${parseResult.error.message}`,
          'INVALID_CONFIG',
        );
      }

      await this.fs.writeFile(
        this.configPath,
        JSON.stringify(newConfig, null, 2),
      );

      this.data = parseResult.data;
      this.logger.debug('Configuration updated successfully');
    } catch (error) {
      if (error instanceof ConfigError) {
        throw error;
      }

      throw new ConfigError(
        `Failed to update configuration: ${(error as Error).message}`,
        'CONFIG_UPDATE_ERROR',
      );
    }
  }

  async validate(): Promise<void> {
    const pathsToCheck = [
      this.packageRoot,
      this.binariesPath,
      this.tempDir,
      this.goinfre,
      this.sgoinfre,
    ];

    for (const path of pathsToCheck) {
      try {
        await this.fs.mkdir(path, {recursive: true}); // eslint-disable-line no-await-in-loop
      } catch {
        throw new ConfigError(
          `Failed to ensure directory exists: ${path}`,
          'DIRECTORY_CREATE_ERROR',
        );
      }
    }
  }

  // Exposed for testing
  async _reset(): Promise<void> {
    if (env.NODE_ENV === 'test') {
      await this.createDefaultConfig();
    }
  }

  private async loadConfig(): Promise<void> {
    try {
      if (!await this.fs.exists(this.configPath)) {
        throw new ConfigError('Configuration file not found', 'CONFIG_NOT_FOUND');
      }

      const rawData = await this.fs.readFile(this.configPath);
      const jsonData: unknown = JSON.parse(rawData.toString());

      const parseResult = configSchema.safeParse(jsonData);
      if (!parseResult.success) {
        throw new ConfigError(
          `Invalid configuration: ${parseResult.error.message}`,
          'INVALID_CONFIG',
        );
      }

      this.data = parseResult.data;
      this.logger.debug('Configuration loaded successfully');
    } catch (error) {
      if (error instanceof ConfigError) {
        throw error;
      }

      throw new ConfigError(
        `Failed to load configuration: ${(error as Error).message}`,
        'CONFIG_LOAD_ERROR',
      );
    }
  }

  private async createDefaultConfig(): Promise<void> {
    const username = env.USER ?? env.USERNAME;
    if (!username) {
      throw new ConfigError('Unable to determine username', 'NO_USERNAME');
    }

    const defaultConfig: ConfigData = {
      packageRoot: join('/sgoinfre', username, 'packages'),
      binariesPath: join(homedir(), 'bin'),
      tempDir: join(homedir(), '.cache', 'diem'),
      goinfre: join('/goinfre', username),
      sgoinfre: join('/sgoinfre', username),
      logLevel: 'info',
      registryConfig: {
        providers: [],
        defaultProvider: undefined,
      },
    };

    try {
      // Ensure config directory exists
      const configDirectory = join(homedir(), '.config', 'diem');
      await this.fs.mkdir(configDirectory, {recursive: true});

      // Write default config
      await this.fs.writeFile(
        this.configPath,
        JSON.stringify(defaultConfig, null, 2),
      );

      this.data = defaultConfig;
      this.logger.info('Created default configuration');
    } catch (error) {
      throw new ConfigError(
        `Failed to create default configuration: ${(error as Error).message}`,
        'CONFIG_CREATE_ERROR',
      );
    }
  }

  // Helper method to merge environment variables with config
  private mergeWithEnv(config: ConfigData): ConfigData {
    return {
      ...config,
      logLevel: (env.DIEM_LOG_LEVEL as ConfigData['logLevel']) ?? config.logLevel,
      packageRoot: env.DIEM_PACKAGE_ROOT ?? config.packageRoot,
      binariesPath: env.DIEM_BINARIES_PATH ?? config.binariesPath,
      tempDir: env.DIEM_TEMP_DIR ?? config.tempDir,
      goinfre: env.DIEM_GOINFRE ?? config.goinfre,
      sgoinfre: env.DIEM_SGOINFRE ?? config.sgoinfre,
    };
  }
}
