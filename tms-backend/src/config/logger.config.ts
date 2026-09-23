import { utilities as nestWinstonUtilities } from 'nest-winston';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

import { AppConfig } from './app-config';
import { redactSecrets } from './redact.format';

/**
 * Console output for humans, rotating JSON files on disk for everything else.
 * Errors additionally get their own file so they are easy to grep.
 */
export function buildWinstonOptions(config: AppConfig): winston.LoggerOptions {
  const { dir: dirname, maxFiles, maxSize } = config.logger;

  const fileFormat = winston.format.combine(
    redactSecrets(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  );

  return {
    level: config.logger.level,
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          redactSecrets(),
          winston.format.timestamp(),
          winston.format.ms(),
          nestWinstonUtilities.format.nestLike('TMS', {
            colors: true,
            prettyPrint: true,
          }),
        ),
      }),
      new DailyRotateFile({
        dirname,
        filename: 'tms-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize,
        maxFiles,
        format: fileFormat,
      }),
      new DailyRotateFile({
        dirname,
        filename: 'tms-error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        zippedArchive: true,
        maxSize,
        maxFiles,
        format: fileFormat,
      }),
    ],
  };
}
