import {join} from 'node:path';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import {homedir} from 'node:os';
import {mightFail, mightFailSync} from '@might/fail';
import {logger} from './logger';
import {
  zRegistryConfig,
  type RegistryConfig,
  type PackageReference,
  parsePackageReference,
} from './config-types';

export class RegistryManager {
  private readonly configPath: string;
  private readonly sgoinfre: string = '/sgoinfre'; // eslint-disable-line @typescript-eslint/class-literal-property-style

  constructor() {
    this.configPath = join(homedir(), '.config', 'frog', 'config.json');
    this.ensureConfig();
  }

  async getConfig(): Promise<RegistryConfig> {
    const [readError, rawData] = mightFailSync(() =>
      readFileSync(this.configPath, 'utf8'),
    );

    if (readError) {
      logger.error('Failed to read config:', readError);
      throw readError;
    }

    const [parseError, parsedData] = mightFailSync(() =>
      JSON.parse(rawData) as unknown,
    );

    if (parseError) {
      logger.error('Failed to parse config:', parseError);
      throw parseError;
    }

    const [validateError, config] = mightFailSync(() =>
      zRegistryConfig.parse(parsedData),
    );

    if (validateError) {
      logger.error('Invalid config format:', validateError);
      throw validateError;
    }

    return config;
  }

  async addProvider(username: string): Promise<void> {
    const [configError, config] = await mightFail(this.getConfig());
    if (configError) {
      logger.error('Failed to load config:', configError);
      return;
    }

    if (config.providers.includes(username)) {
      logger.warn(`Provider ${username} is already in the registry`);
      return;
    }

    const providerPath = join(this.sgoinfre, username);
    if (!existsSync(providerPath)) {
      logger.error(`Provider path ${providerPath} does not exist`);
      return;
    }

    config.providers.push(username);

    const [writeError] = mightFailSync(() => {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    },
    );

    if (writeError) {
      logger.error('Failed to update config:', writeError);
      return;
    }

    logger.info(`Successfully added provider ${username}`);
  }

  async removeProvider(username: string): Promise<void> {
    const [configError, config] = await mightFail(this.getConfig());
    if (configError) {
      logger.error('Failed to load config:', configError);
      return;
    }

    const index = config.providers.indexOf(username);
    if (index === -1) {
      logger.warn(`Provider ${username} is not in the registry`);
      return;
    }

    config.providers.splice(index, 1);

    if (config.defaultProvider === username) {
      config.defaultProvider = undefined;
    }

    const [writeError] = mightFailSync(() => {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    },
    );

    if (writeError) {
      logger.error('Failed to update config:', writeError);
      return;
    }

    logger.info(`Successfully removed provider ${username}`);
  }

  async setDefaultProvider(username: string): Promise<void> {
    const [configError, config] = await mightFail(this.getConfig());
    if (configError) {
      logger.error('Failed to load config:', configError);
      return;
    }

    if (!config.providers.includes(username)) {
      logger.error(`Provider ${username} is not in the registry. Add it first.`);
      return;
    }

    config.defaultProvider = username;

    const [writeError] = mightFailSync(() => {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    },
    );

    if (writeError) {
      logger.error('Failed to update config:', writeError);
      return;
    }

    logger.info(`Successfully set ${username} as default provider`);
  }

  async resolvePackageLocation(packageReference: string): Promise<string | undefined> {
    const [configError, config] = await mightFail(this.getConfig());
    if (configError) {
      logger.error('Failed to load config:', configError);
      return;
    }

    const [parseError, reference] = mightFailSync(() =>
      parsePackageReference(packageReference, config.defaultProvider),
    );

    if (parseError) {
      logger.error('Failed to parse package reference:', parseError);
      return;
    }

    if (!config.providers.includes(reference.provider)) {
      logger.error(`Provider ${reference.provider} is not in the registry`);
      return;
    }

    const packagePath = join(this.sgoinfre, reference.provider, reference.name);
    if (!existsSync(packagePath)) {
      logger.error(`Package ${reference.name} not found in ${reference.provider}'s registry`);
      return;
    }

    return packagePath;
  }

  async listProviders(): Promise<void> {
    const [configError, config] = await mightFail(this.getConfig());
    if (configError) {
      logger.error('Failed to load config:', configError);
      return;
    }

    if (config.providers.length === 0) {
      logger.info('No providers configured');
      return;
    }

    logger.info('Configured providers:');
    for (const provider of config.providers) {
      const isDefault = provider === config.defaultProvider ? ' (default)' : '';
      logger.info(`  - ${provider}${isDefault}`);
    }
  }

  private ensureConfig(): void {
    const [mkdirError] = mightFailSync(() => {
      const configDirectory = join(homedir(), '.config', 'frog');
      if (!existsSync(configDirectory)) {
        mkdirSync(configDirectory, {recursive: true});
      }
    });

    if (mkdirError) {
      logger.error('Failed to create config directory:', mkdirError);
      throw mkdirError;
    }

    if (!existsSync(this.configPath)) {
      const defaultConfig: RegistryConfig = {
        providers: [],
        defaultProvider: undefined,
      };

      const [writeError] = mightFailSync(() => {
        writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2));
      },
      );

      if (writeError) {
        logger.error('Failed to create default config:', writeError);
        throw writeError;
      }
    }
  }
}
