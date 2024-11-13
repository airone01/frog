import {
  createLogger, format, transports, type Logger as WinstonLoggerType,
} from 'winston';
import {consoleFormat} from 'winston-console-format';
import {type Logger} from './logger';

export type LoggerOptions = {
  level?: string;
  serviceName?: string;
  environment?: string;
  console?: boolean;
  file?: {
    enabled: boolean;
    filename: string;
    maxSize: number;
    maxFiles: number;
  };
};

export class WinstonLogger implements Logger {
  private readonly logger: WinstonLoggerType;

  constructor(options: LoggerOptions = {}) {
    this.logger = this.createLogger(options);
  }

  debug(message: string, ...arguments_: unknown[]): void {
    this.logger.debug(message, ...this.formatArgs(arguments_));
  }

  info(message: string, ...arguments_: unknown[]): void {
    this.logger.info(message, ...this.formatArgs(arguments_));
  }

  warn(message: string, ...arguments_: unknown[]): void {
    this.logger.warn(message, ...this.formatArgs(arguments_));
  }

  error(message: string, ...arguments_: unknown[]): void {
    this.logger.error(message, ...this.formatArgs(arguments_));
  }

  child(options: Record<string, unknown>): Logger {
    return new ChildWinstonLogger(this.logger.child(options));
  }

  private formatArgs(arguments_: unknown[]): unknown[] {
    return arguments_.map(argument => {
      if (argument instanceof Error) {
        return {
          ...argument,
          message: argument.message,
          stack: argument.stack,
        };
      }

      return argument;
    });
  }

  private createLogger(options: LoggerOptions): WinstonLoggerType {
    const {
      level = 'info',
      serviceName = 'diem',
      environment = 'development',
      console: enableConsole = true,
      file = {
        enabled: false, filename: 'logs/diem.log', maxSize: 5_242_880, maxFiles: 5,
      },
    } = options;

    const loggerTransports = [];

    // Console transport with fancy formatting for development
    if (enableConsole) {
      loggerTransports.push(
        new transports.Console({
          level,
          format: format.combine(
            format.colorize({all: true}),
            format.padLevels(),
            consoleFormat({
              showMeta: true,
              metaStrip: ['timestamp', 'service'],
              inspectOptions: {
                depth: 4,
                colors: true,
                maxArrayLength: 10,
                breakLength: 120,
                compact: true,
              },
            }),
          ),
        }),
      );
    }

    // File transport for production logging
    if (file.enabled) {
      loggerTransports.push(
        new transports.File({
          filename: file.filename,
          maxsize: file.maxSize,
          maxFiles: file.maxFiles,
          format: format.combine(
            format.timestamp(),
            format.json(),
          ),
        }),
      );
    }

    return createLogger({
      level,
      defaultMeta: {
        service: serviceName,
        environment,
      },
      format: format.combine(
        format.timestamp(),
        format.errors({stack: true}),
        format.splat(),
        format.json(),
      ),
      transports: loggerTransports,
    });
  }
}

// Child logger implementation for contextual logging
class ChildWinstonLogger implements Logger {
  constructor(private readonly logger: WinstonLoggerType) {}

  debug(message: string, ...arguments_: unknown[]): void {
    this.logger.debug(message, ...arguments_);
  }

  info(message: string, ...arguments_: unknown[]): void {
    this.logger.info(message, ...arguments_);
  }

  warn(message: string, ...arguments_: unknown[]): void {
    this.logger.warn(message, ...arguments_);
  }

  error(message: string, ...arguments_: unknown[]): void {
    this.logger.error(message, ...arguments_);
  }

  child(options: Record<string, unknown>): Logger {
    return new ChildWinstonLogger(this.logger.child(options));
  }
}
