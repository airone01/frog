import {
  constants,
  createReadStream,
  createWriteStream,
  type Stats,
} from 'node:fs';
import {
  chmod,
  mkdir,
  readFile,
  writeFile,
  unlink,
  symlink,
  readdir,
  stat,
  rm,
  cp,
} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {type Logger} from '../logging/logger';
import {type FileSystem} from './file-system';
import {ensureDirectory} from './utils';

export class FileSystemError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly path: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'FileSystemError';
  }
}

export class NodeFileSystem implements FileSystem {
  constructor(private readonly logger: Logger) {}

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    try {
      const buffer = await readFile(path);
      return new Uint8Array(buffer);
    } catch (error) {
      throw new FileSystemError(
        `Failed to read file: ${path}`,
        'READ_ERROR',
        path,
        error as Error,
      );
    }
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    try {
      await ensureDirectory(dirname(path));
      await writeFile(path, data);
    } catch (error) {
      throw new FileSystemError(
        `Failed to write file: ${path}`,
        'WRITE_ERROR',
        path,
        error as Error,
      );
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await rm(path, {recursive: true, force: true});
    } catch (error) {
      throw new FileSystemError(
        `Failed to remove: ${path}`,
        'REMOVE_ERROR',
        path,
        error as Error,
      );
    }
  }

  async mkdir(path: string, options?: {recursive: boolean}): Promise<void> {
    try {
      await mkdir(path, {recursive: options?.recursive ?? false});
    } catch (error) {
      throw new FileSystemError(
        `Failed to create directory: ${path}`,
        'MKDIR_ERROR',
        path,
        error as Error,
      );
    }
  }

  async symlink(source: string, target: string): Promise<void> {
    try {
      await ensureDirectory(dirname(target));

      // Remove existing symlink if it exists
      if (await this.exists(target)) {
        const stats = await stat(target);
        if (stats.isSymbolicLink()) {
          await unlink(target);
        } else {
          throw new FileSystemError(
            `Target exists and is not a symlink: ${target}`,
            'SYMLINK_TARGET_EXISTS',
            target,
          );
        }
      }

      await symlink(source, target);
      await chmod(source, 0o755); // Make source executable
    } catch (error) {
      throw new FileSystemError(
        `Failed to create symlink from ${source} to ${target}`,
        'SYMLINK_ERROR',
        target,
        error as Error,
      );
    }
  }

  async copy(source: string, destination: string): Promise<void> {
    try {
      await ensureDirectory(dirname(destination));
      await cp(source, destination, {
        recursive: true,
        force: true,
        preserveTimestamps: true,
      });
    } catch (error) {
      throw new FileSystemError(
        `Failed to copy from ${source} to ${destination}`,
        'COPY_ERROR',
        destination,
        error as Error,
      );
    }
  }

  async getStats(path: string): Promise<Stats> {
    try {
      return await stat(path);
    } catch (error) {
      throw new FileSystemError(
        `Failed to get stats for: ${path}`,
        'STAT_ERROR',
        path,
        error as Error,
      );
    }
  }

  async listFiles(directory: string): Promise<string[]> {
    try {
      return await readdir(directory);
    } catch (error) {
      throw new FileSystemError(
        `Failed to list directory: ${directory}`,
        'LIST_ERROR',
        directory,
        error as Error,
      );
    }
  }

  async copyFile(source: string, destination: string): Promise<void> {
    try {
      await ensureDirectory(dirname(destination));
      await pipeline(
        createReadStream(source),
        createWriteStream(destination, {mode: 0o644}),
      );
    } catch (error) {
      throw new FileSystemError(
        `Failed to copy file from ${source} to ${destination}`,
        'COPY_FILE_ERROR',
        destination,
        error as Error,
      );
    }
  }

  async isSymlink(path: string): Promise<boolean> {
    try {
      const stats = await stat(path);
      return stats.isSymbolicLink();
    } catch {
      return false;
    }
  }

  async ensureSymlink(source: string, target: string): Promise<void> {
    try {
      // Check if target already exists and is a symlink pointing to the correct source
      if (await this.exists(target)) {
        const stats = await stat(target);
        if (stats.isSymbolicLink()) {
          const currentTarget = await readFile(target, 'utf8');
          if (currentTarget === source) {
            return; // Symlink already exists and points to the correct location
          }

          await unlink(target); // Remove incorrect symlink
        } else {
          throw new FileSystemError(
            `Target exists and is not a symlink: ${target}`,
            'SYMLINK_TARGET_EXISTS',
            target,
          );
        }
      }

      await this.symlink(source, target);
    } catch (error) {
      throw new FileSystemError(
        `Failed to ensure symlink from ${source} to ${target}`,
        'SYMLINK_ERROR',
        target,
        error as Error,
      );
    }
  }
}
