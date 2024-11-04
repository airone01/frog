import {resolve} from 'node:path';
import {
  chmod, mkdir, link, exists,
} from 'node:fs/promises';
import {env} from 'node:process';
import ora from 'ora';
import {$} from 'bun';
import {config} from '../config';

const releaseUrl = 'https://download.jetbrains.com/cpp/CLion-2024.2.3.tar.gz';

async function jetbrainsClion() {
  const s = ora('Downloading clion').start();

  const clionBasePah = resolve(env.HOME!, 'goinfre', 'frog_data', 'clion');

  try {
    if (!await exists(clionBasePah)) {
      // DL original gz
      const response = await fetch(releaseUrl);

      // Write to file
      const tarGzPath = resolve(config.binPath, 'clion-dl.tar.gz');
      await Bun.write(tarGzPath, response);

      // Uncompress
      s.text = 'Uncompressing clion';
      const directoryPath = resolve(config.binPath, 'clion-dl');
      await mkdir(directoryPath);
      await $`tar -xf ${tarGzPath} -C ${directoryPath}`;

      // Install to goinfre
      s.text = 'Installing clion';
      await $`mv ${directoryPath} ${clionBasePah}`;

      // Clean up
      await $`rm ${tarGzPath}`;
    }

    const finalBinaryPath = resolve(config.binPath, 'clion');
    const binaryPath = resolve(clionBasePah, 'bin', 'clion.sh');
    await link(binaryPath, finalBinaryPath);

    // Perms
    await chmod(finalBinaryPath, '755');

    s.succeed('Installed clion');
  } catch {
    s.fail('There was a problem downloading clion. Sorry 0_0');
  }
}

export {
  jetbrainsClion,
};
