import {join} from 'node:path';
import {
  mkdir, writeFile, symlink, readFile, unlink, rm,
} from 'node:fs/promises';
import {cwd} from 'node:process';
import {
  expect, describe, test, beforeEach, afterEach,
} from 'bun:test';
import {NodeFileSystem, FileSystemError} from '../node-file-system';
import {type Logger} from '../../logging/logger';

// Mock logger for testing
class TestLogger implements Logger {
  logs: Array<{level: string; message: string; args: unknown[]}> = [];

  debug(message: string, ...arguments_: unknown[]) {
    this.logs.push({level: 'debug', message, args: arguments_});
  }

  info(message: string, ...arguments_: unknown[]) {
    this.logs.push({level: 'info', message, args: arguments_});
  }

  warn(message: string, ...arguments_: unknown[]) {
    this.logs.push({level: 'warn', message, args: arguments_});
  }

  error(message: string, ...arguments_: unknown[]) {
    this.logs.push({level: 'error', message, args: arguments_});
  }

  clear() {
    this.logs = [];
  }
}

describe('NodeFileSystem', () => {
  const testDirectory = join(cwd(), 'test-fs');
  const logger = new TestLogger();
  const fs = new NodeFileSystem(logger);

  // Set up test directory before each test
  beforeEach(async () => {
    await mkdir(testDirectory, {recursive: true});
  });

  // Clean up test directory after each test
  afterEach(async () => {
    await rm(testDirectory, {recursive: true, force: true});
    logger.clear();
  });

  describe('exists', () => {
    test('returns true for existing file', async () => {
      const testFile = join(testDirectory, 'test.txt');
      await writeFile(testFile, 'test');
      expect(await fs.exists(testFile)).toBe(true);
    });

    test('returns false for non-existing file', async () => {
      const nonExistentFile = join(testDirectory, 'nonexistent.txt');
      expect(await fs.exists(nonExistentFile)).toBe(false);
    });
  });

  describe('readFile', () => {
    test('reads file contents correctly', async () => {
      const testFile = join(testDirectory, 'test.txt');
      const content = 'Hello, World!';
      await writeFile(testFile, content);

      const result = await fs.readFile(testFile);
      expect(result.toString()).toBe(content);
    });

    test('throws FileSystemError for non-existent file', async () => {
      const nonExistentFile = join(testDirectory, 'nonexistent.txt');

      expect(async () => {
        await readFile(nonExistentFile);
      }).toThrow(FileSystemError);
    });
  });

  describe('writeFile', () => {
    test('writes file contents correctly', async () => {
      const testFile = join(testDirectory, 'test.txt');
      const content = 'Hello, World!';

      await fs.writeFile(testFile, content);
      const result = await readFile(testFile, 'utf8');
      expect(result).toBe(content);
    });

    test('creates directories if they don\'t exist', async () => {
      const nestedFile = join(testDirectory, 'nested', 'deep', 'test.txt');
      const content = 'nested content';

      await fs.writeFile(nestedFile, content);
      const result = await readFile(nestedFile, 'utf8');
      expect(result).toBe(content);
    });
  });

  describe('symlink', () => {
    test('creates symlink correctly', async () => {
      const sourceFile = join(testDirectory, 'source.txt');
      const linkFile = join(testDirectory, 'link.txt');
      const content = 'source content';

      await writeFile(sourceFile, content);
      await fs.symlink(sourceFile, linkFile);

      const result = await readFile(linkFile, 'utf8');
      expect(result).toBe(content);
    });

    test('replaces existing symlink', async () => {
      const sourceFile1 = join(testDirectory, 'source1.txt');
      const sourceFile2 = join(testDirectory, 'source2.txt');
      const linkFile = join(testDirectory, 'link.txt');

      await writeFile(sourceFile1, 'content1');
      await writeFile(sourceFile2, 'content2');
      await symlink(sourceFile1, linkFile);

      await fs.symlink(sourceFile2, linkFile);
      const result = await readFile(linkFile, 'utf8');
      expect(result).toBe('content2');
    });

    test('throws error if target exists and is not a symlink', async () => {
      const sourceFile = join(testDirectory, 'source.txt');
      const targetFile = join(testDirectory, 'target.txt');

      await writeFile(sourceFile, 'source');
      await writeFile(targetFile, 'target');

      expect(async () => {
        await symlink(sourceFile, targetFile);
      }).toThrow(FileSystemError);
    });
  });

  describe('copy', () => {
    test('copies files and directories recursively', async () => {
      const sourceDirectory = join(testDirectory, 'source');
      const destinationDirectory = join(testDirectory, 'dest');
      const testFile = join(sourceDirectory, 'test.txt');
      const nestedFile = join(sourceDirectory, 'nested', 'deep.txt');

      await mkdir(sourceDirectory, {recursive: true});
      await mkdir(join(sourceDirectory, 'nested'), {recursive: true});
      await writeFile(testFile, 'test content');
      await writeFile(nestedFile, 'nested content');

      await fs.copy(sourceDirectory, destinationDirectory);

      expect(await fs.exists(join(destinationDirectory, 'test.txt'))).toBe(true);
      expect(await fs.exists(join(destinationDirectory, 'nested', 'deep.txt'))).toBe(true);
      expect(await readFile(join(destinationDirectory, 'test.txt'), 'utf8')).toBe('test content');
      expect(await readFile(join(destinationDirectory, 'nested', 'deep.txt'), 'utf8')).toBe('nested content');
    });
  });

  describe('remove', () => {
    test('removes files and directories recursively', async () => {
      const testDirectory2 = join(testDirectory, 'test');
      const testFile = join(testDirectory2, 'test.txt');
      const nestedFile = join(testDirectory2, 'nested', 'deep.txt');

      await mkdir(testDirectory2, {recursive: true});
      await mkdir(join(testDirectory2, 'nested'), {recursive: true});
      await writeFile(testFile, 'test');
      await writeFile(nestedFile, 'nested');

      await fs.remove(testDirectory2);

      expect(await fs.exists(testDirectory2)).toBe(false);
    });

    test('doesn\'t throw on non-existent paths', async () => {
      const nonExistentPath = join(testDirectory, 'nonexistent');
      expect(fs.remove(nonExistentPath)).resolves.not.toThrow();
    });
  });

  describe('ensureSymlink', () => {
    test('creates new symlink if none exists', async () => {
      const sourceFile = join(testDirectory, 'source.txt');
      const linkFile = join(testDirectory, 'link.txt');

      await writeFile(sourceFile, 'content');
      await fs.ensureSymlink(sourceFile, linkFile);

      expect(await fs.isSymlink(linkFile)).toBe(true);
      expect(await readFile(linkFile, 'utf8')).toBe('content');
    });

    test('keeps existing symlink if it points to the same target', async () => {
      const sourceFile = join(testDirectory, 'source.txt');
      const linkFile = join(testDirectory, 'link.txt');

      await writeFile(sourceFile, 'content');
      await symlink(sourceFile, linkFile);
      const originalStats = await fs.getStats(linkFile);

      await fs.ensureSymlink(sourceFile, linkFile);
      const newStats = await fs.getStats(linkFile);

      expect(newStats.mtimeMs).toBe(originalStats.mtimeMs);
    });

    test('replaces symlink if it points to different target', async () => {
      const source1 = join(testDirectory, 'source1.txt');
      const source2 = join(testDirectory, 'source2.txt');
      const linkFile = join(testDirectory, 'link.txt');

      await writeFile(source1, 'content1');
      await writeFile(source2, 'content2');
      await symlink(source1, linkFile);

      await fs.ensureSymlink(source2, linkFile);
      expect(await readFile(linkFile, 'utf8')).toBe('content2');
    });
  });

  describe('error handling', () => {
    test('logs errors appropriately', async () => {
      const nonExistentFile = join(testDirectory, 'nonexistent.txt');

      try {
        await fs.readFile(nonExistentFile);
      } catch {
        // Ignore error
      }

      expect(logger.logs.some(log =>
        log.level === 'error' && log.message.includes('Failed to read file'),
      )).toBe(true);
    });

    test('includes correct error codes', async () => {
      const nonExistentFile = join(testDirectory, 'nonexistent.txt');

      try {
        await fs.readFile(nonExistentFile);
      } catch (error) {
        expect(error).toBeInstanceOf(FileSystemError);
        expect((error as FileSystemError).code).toBe('READ_ERROR');
      }
    });
  });
});
