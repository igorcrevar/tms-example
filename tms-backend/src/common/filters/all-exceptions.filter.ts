import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import type { Request } from 'express';

/**
 * The outer layer: services and controllers throw, this logs. Nothing below
 * should log an exception it is about to raise.
 */
@Catch()
export class AllExceptionsFilter extends SentryGlobalFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    // Path only: an invitation preview carries its one-time token in the query string.
    const where = `${request.method} ${request.originalUrl.split('?')[0]}`;
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const message = exception instanceof Error ? exception.message : String(exception);

    if (status >= 500) {
      this.logger.error(
        `${where} failed with ${status}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${where} refused with ${status}: ${message}`);
    }

    super.catch(exception, host);
  }
}
