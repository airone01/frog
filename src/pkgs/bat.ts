import axios from 'axios';
import ora from 'ora';

const releaseUrl = 'https://github.com/sharkdp/bat/releases/download/v0.24.0/bat-v0.24.0-x86_64-unknown-linux-gnu.tar.gz';

const s = ora('Downloading bat').start();

async function bat() {
  try {
    const response = await axios
      .get(releaseUrl);

    if (!response.data) {
      throw new Error('data');
    }

    s.succeed('Downloaded bat');
    console.log(response.data);
  } catch {
    s.fail('There was a problem downloading bat. Sorry 0_0');
  }
}

export {
  bat,
};
