import {mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

export async function ensureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, {recursive: true});
  } catch (error) {
    // Ignore error if directory already exists
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

