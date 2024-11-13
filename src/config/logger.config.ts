import {type LoggerOptions} from '../infrastructure/logging/winston-logger';

export const getLoggerConfig = (env: string): LoggerOptions => ({
  level: env === 'production' ? 'info' : 'debug',
  serviceName: 'diem',
  environment: env,
  console: true,
  file: {
    enabled: env === 'production',
    filename: 'logs/diem.log',
    maxSize: 5 * 1024 * 1024, // 5MB
    maxFiles: 5,
  },
});
