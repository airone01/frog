import type {Stats} from 'node:fs';

export type FileSystem = {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string, options?: {recursive: boolean}): Promise<void>;
  symlink(source: string, target: string): Promise<void>;
  copy(source: string, destination: string): Promise<void>;
  getStats(path: string): Promise<Stats>;
  listFiles(directory: string): Promise<string[]>;
  copyFile(source: string, destination: string): Promise<void>;
  isSymlink(path: string): Promise<boolean>;
  ensureSymlink(source: string, target: string): Promise<void>;
};
