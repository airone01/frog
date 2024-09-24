import {resolve} from 'node:path';
import {chmod, mkdir} from 'node:fs/promises';
import ora from 'ora';
import {$} from 'bun';
import {config} from '../config';

const releaseUrl = 'https://github.com/sharkdp/bat/releases/download/v0.24.0/bat-v0.24.0-x86_64-unknown-linux-gnu.tar.gz';

async function bat() {
  const s = ora('Downloading bat').start();
  try {
    // DL original gz
    const response = await fetch(releaseUrl);

    // Write to file
    const tarGzPath = resolve(config.binPath, 'bat-dl.tar.gz');
    await Bun.write(tarGzPath, response);

    // Uncompress
    s.text = 'Uncompressing bat';
    const directoryPath = resolve(config.binPath, 'bat-dl');
    await mkdir(directoryPath);
    await $`tar -xf ${tarGzPath} -C ${directoryPath}`;

    // Install
    const directoryBinaryPath = resolve(config.binPath, 'bat-dl', 'bat-v0.24.0-x86_64-unknown-linux-gnu', 'bat');
    const binaryPath = resolve(config.binPath, 'bat');
    await $`mv ${directoryBinaryPath} ${binaryPath}`;

    // Perms
    await chmod(binaryPath, '755');

    // Clean up
    await $`rm -r ${directoryPath}`;
    await $`rm ${tarGzPath}`;

    s.succeed('Downloaded bat');
  } catch {
    s.fail('There was a problem downloading bat. Sorry 0_0');
  }
}

export {
  bat,
};
