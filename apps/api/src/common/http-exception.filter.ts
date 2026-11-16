import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { AppRequest } from './request-context.js';

interface ErrorBody { code?: string; message?: string; details?: unknown }

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<AppRequest>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody = { code: 'internal_error', message: 'Something went wrong' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      if (typeof r === 'string') body = { code: `http_${status}`, message: r };
      else {
        const o = r as Record<string, unknown>;
        body = {
          code: typeof o.code === 'string' ? o.code : `http_${status}`,
          message: typeof o.message === 'string' ? o.message : exception.message,
          ...(o.details !== undefined ? { details: o.details } : {}),
        };
      }
    } else {
      // Never leak internals; log the real error with the request id for correlation.
      this.logger.error(JSON.stringify({ requestId: req.requestId, err: exception instanceof Error ? exception.stack : String(exception) }));
    }
    res.status(status).json({ error: { ...body, requestId: req.requestId } });
  }
}
