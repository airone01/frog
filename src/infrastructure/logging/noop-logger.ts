/* eslint-disable @typescript-eslint/no-empty-function */
import type {Logger} from './logger';

export class NoopLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this;
  }
}
