import {resolve} from 'node:path';
import {chmod, mkdir} from 'node:fs/promises';
import ora from 'ora';
import {$} from 'bun';
import {config} from '../config';

const releaseUrl = 'https://github.com/eza-community/eza/releases/download/v0.20.6/eza_x86_64-unknown-linux-gnu.tar.gz';

async function eza() {
  const s = ora('Downloading eza').start();
  try {
    // DL original gz
    const response = await fetch(releaseUrl);

    // Write to file
    const tarGzPath = resolve(config.binPath, 'eza-dl.tar.gz');
    await Bun.write(tarGzPath, response);

    // Uncompress
    s.text = 'Uncompressing eza';
    const directoryPath = resolve(config.binPath, 'eza-dl');
    await mkdir(directoryPath);
    await $`tar -xf ${tarGzPath} -C ${directoryPath}`;

    // Install
    const directoryBinaryPath = resolve(config.binPath, 'eza-dl', 'eza');
    const binaryPath = resolve(config.binPath, 'eza');
    await $`mv ${directoryBinaryPath} ${binaryPath}`;

    // Perms
    await chmod(binaryPath, '755');

    // Clean up
    await $`rm -r ${directoryPath}`;
    await $`rm ${tarGzPath}`;

    s.succeed('Installed eza');
  } catch {
    s.fail('There was a problem downloading eza. Sorry 0_0');
  }
}

export {
  eza,
};
