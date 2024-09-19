import {Command} from 'commander';
import {setup} from './setup.js';
import {bat} from './pkgs/bat.js';

const program = new Command();

program
  .name('frog')
  .description('Package manager for 42 students :-)')
  .version('v0.1.0');

program.command('setup', {isDefault: true})
  .description('install/update frog on your machine')
  .action(() => {
    setup();
  });

program.command('install')
  .argument('package', 'package to download')
  .action(arguments_ => {
    switch (arguments_[0]) { // eslint-disable-line @typescript-eslint/switch-exhaustiveness-check
      case 'bat': {
        bat()
          .catch(() => { // eslint-disable-line promise/prefer-await-to-then
            console.log('there was an error');
          });
      }
    }
  });

program.parse();
