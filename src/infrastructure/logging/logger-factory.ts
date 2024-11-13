import type {Logger} from './logger';
import {WinstonLogger, type LoggerOptions} from './winston-logger';

export class LoggerFactory { // eslint-disable-line @typescript-eslint/no-extraneous-class
  static initialize(options: LoggerOptions = {}): void {
    this.instance = new WinstonLogger(options);
  }

  static getLogger(): Logger {
    if (!this.instance) {
      this.initialize();
    }

    return this.instance;
  }

  private static instance: Logger;
}
