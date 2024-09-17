/* eslint-disable n/no-unsupported-features/es-syntax */
import {Command} from 'commander';

const program = new Command();

program
  .name('frog')
  .description('Package manager for 42 students :-)')
  .version('v0.1.0');

program.command('setup', {isDefault: true})
  .description('install/update frog on your machine');
program.command('install');

program.parse();
