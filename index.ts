import {Command} from 'commander';
import {z} from 'zod';
import {displayTitle, setup} from './src/setup';
import {bat} from './src/pkgs/bat';
import {eza} from './src/pkgs';

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
  .description('install a package/app')
  .action(async arguments_ => {
    const {success, data} = z.string().safeParse(arguments_);
    if (!success) {
      console.error('Please provide a package name.');
      return;
    }

    displayTitle();

    const packageName = data.split(' ')[0];
    switch (packageName) {
      case 'bat': {
        await bat();
        break;
      }

      case 'eza': {
        await eza();
        break;
      }

      default: {
        console.log('This package does not exist (yet!)\nList all packages with "frog list"');
      }
    }
  });

program.parse();
