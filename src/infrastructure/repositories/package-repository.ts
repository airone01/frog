import {join} from 'node:path';
import {z} from 'zod';
import {type FileSystem} from '../fs/file-system';
import {type Logger} from '../logging/logger';
import {type Config} from '../config/config';
import {type Package} from '../../domain/models/package';
import type {PackageReference} from '../../domain/models';

const packageDatabaseSchema = z.record(z.string(), z.object({
  name: z.string(),
  version: z.string(),
  provider: z.string().optional(),
  binaries: z.array(z.string()),
  installScript: z.string().optional(),
  url: z.string().url().optional(),
}));

type PackageDatabase = z.infer<typeof packageDatabaseSchema>;

export class PackageRepositoryError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'PackageRepositoryError';
  }
}

export class PackageRepository {
  private readonly dbPath: string;
  private database: PackageDatabase | undefined = undefined;

  constructor(
    private readonly fs: FileSystem,
    private readonly logger: Logger,
    private readonly config: Config,
  ) {
    this.dbPath = join(config.packageRoot, 'package-db.json');
  }

  async initialize(): Promise<void> {
    await this.ensureDatabase();
  }

  async findByName(name: string): Promise<Package | undefined> {
    const database = await this.getDatabase();
    return database[name];
  }

  async findByReference(reference: PackageReference): Promise<Package | undefined> {
    const key = this.createKey(reference);
    const database = await this.getDatabase();
    return database[key];
  }

  async save(package_: Package, reference: PackageReference): Promise<void> {
    const database = await this.getDatabase();
    const key = this.createKey(reference);

    database[key] = {
      name: package_.name,
      version: package_.version,
      provider: reference.provider,
      binaries: package_.binaries,
      installScript: package_.installScript,
      url: package_.url,
    };

    await this.saveDatabase(database);
  }

  async remove(reference: PackageReference): Promise<void> {
    const database = await this.getDatabase();
    const key = this.createKey(reference);

    if (key in database) {
      delete database[key]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
      await this.saveDatabase(database);
    }
  }

  async list(): Promise<Package[]> {
    const database = await this.getDatabase();
    return Object.values(database);
  }

  private createKey(reference: PackageReference): string {
    return `${reference.provider}:${reference.name}`;
  }

  private async getDatabase(): Promise<PackageDatabase> {
    if (!this.database) {
      await this.ensureDatabase();
    }

    return this.database!;
  }

  private async ensureDatabase(): Promise<void> {
    try {
      if (!await this.fs.exists(this.dbPath)) {
        await this.saveDatabase({});
        return;
      }

      const data = await this.fs.readFile(this.dbPath);
      const jsonData: unknown = JSON.parse(data.toString());

      const parseResult = packageDatabaseSchema.safeParse(jsonData);
      if (!parseResult.success) {
        throw new PackageRepositoryError(
          `Invalid database format: ${parseResult.error.message}`,
          'INVALID_DB',
        );
      }

      this.database = parseResult.data;
    } catch (error) {
      if (error instanceof PackageRepositoryError) {
        throw error;
      }

      throw new PackageRepositoryError(
        `Failed to load package database: ${(error as Error).message}`,
        'DB_LOAD_ERROR',
      );
    }
  }

  private async saveDatabase(database: PackageDatabase): Promise<void> {
    try {
      await this.fs.writeFile(
        this.dbPath,
        JSON.stringify(database, null, 2),
      );
      this.database = database;
    } catch (error) {
      throw new PackageRepositoryError(
        `Failed to save package database: ${(error as Error).message}`,
        'DB_SAVE_ERROR',
      );
    }
  }
}
