import c from 'chalk';
// Import * as align from '@topcli/text-align';
import boxen from 'boxen';
import {title} from './figlet.js';

// Function printTitle() {
//   for (const l of title
//     .split('\n')
//     .map(l =>
//       align.center(c.magenta(l.replace(/ /g, '⠀')), 80), // eslint-disable-line unicorn/prefer-string-replace-all
//     )) {
//     console.log(l);
//   }
// }

function setup() {
  // PrintTitle();
  const border = {
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
    top: ' ',
    bottom: ' ',
    left: ' ',
    right: ' ',
  };
  console.log(boxen(c.bold.magentaBright(title.replace(/ /g, '⠀')), {borderStyle: border, textAlignment: 'center', width: 80})); // eslint-disable-line unicorn/prefer-string-replace-all

  console.log(boxen('Welcome. ' + c.bold('frog') + ' is a simple package manager for students and piscineux(ses) of 42. It doesn\'t require root access. '
  + 'Before using it, keep in mind that it\'s a very good idea to always know what you install on your machine. '
  + c.bold('frog') + ' will install stuff that I consider safe, but in the end, it\'s still a script that you probably ran on your machine without second thoughts. '
  + 'I could be hiding viruses in there (but I won\'t). So do be careful. '
  + 'There is plan in the near future to implement file sharing between students using ' + c.bold('sgoinfre') + '.\n\nConsidering that, stay safe, fellow coder!',
  {
    title: 'Disclaimer :-)', titleAlignment: 'center', width: 80, borderColor: 'magentaBright', borderStyle: 'round', textAlignment: 'center',
  }));
}

export {setup};
