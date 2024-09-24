import {exit} from 'node:process';
import {readdir, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {z} from 'zod';

const defaultConfigFilePath = resolve(homedir(), '.config/frog.json');
const defaultBinariesPath = resolve(homedir(), 'bin');

const zVersion = z.enum([
  'v0.1.0',
]);

const zConfig = z.object({
  version: zVersion,
  binPath: z.enum([defaultBinariesPath]),
});
type Config = z.infer<typeof zConfig>;

let configLet: Config | undefined;

const configFile = Bun.file(resolve(defaultConfigFilePath));
if (await configFile.exists()) {
  const configJson: any = await configFile.json(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
  const {success, data} = zConfig.safeParse(configJson);
  if (!success) {
    console.error('Coundn\'t parse your config file. Sorry 0_0');
    exit(1);
  }

  configLet = data;
} else {
  configLet = {
    version: 'v0.1.0',
    binPath: defaultBinariesPath,
  };
}

// Make bin dir if it doesn't exists
try {
  await readdir(configLet.binPath);
} catch {
  await mkdir(configLet.binPath);
}

const config = configLet;
export {config};
