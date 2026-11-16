import { type CallHandler, type ExecutionContext, HttpException, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { type Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import type { Response } from 'express';
import type { Prisma } from '@leadpilot/database';
import type { AppRequest } from '../common/request-context.js';
import { DbService } from '../db/db.module.js';

const HTTP_CODE_METADATA = '__httpCode__';
const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * `Idempotency-Key` on POSTs: the first request runs; a retry with the same key and body replays the stored response (header
 * `Idempotent-Replay: true`) instead of creating a duplicate; the same key with a different body is rejected (422); a retry while the first is
 * still running gets 409. A request that fails releases its key so it can be retried.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (req.method !== 'POST' || key === undefined || !req.apiKey) return next.handle();
    if (!KEY_RE.test(key)) throw new HttpException({ code: 'invalid_idempotency_key', message: 'Idempotency-Key must be 8-128 characters: letters, digits and _ . : -' }, 400);
    const tenantId = req.apiKey.tenantId; const apiKeyId = req.apiKey.id;
    const hash = createHash('sha256').update(`${req.method} ${req.originalUrl.split('?')[0]}\n${JSON.stringify(req.body ?? null)}`).digest('hex');
    const code = (Reflect.getMetadata(HTTP_CODE_METADATA, ctx.getHandler()) as number | undefined) ?? 201;

    return from(this.db.tenantTx({ tenantId }, async (tx) => {
      const claimed = await tx.idempotencyKey.createMany({ data: [{ tenantId, key, apiKeyId, requestHash: hash }], skipDuplicates: true });
      return claimed.count === 1 ? null : tx.idempotencyKey.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key } } });
    })).pipe(mergeMap((prior) => {
      if (prior) {
        if (prior.requestHash !== hash) throw new HttpException({ code: 'idempotency_key_reuse', message: 'This Idempotency-Key was already used with a different request' }, 422);
        if (prior.statusCode === null) throw new HttpException({ code: 'idempotency_in_progress', message: 'A request with this Idempotency-Key is still being processed. Retry shortly.' }, 409);
        res.setHeader('Idempotent-Replay', 'true');
        return of(prior.response as unknown);
      }
      return next.handle().pipe(
        mergeMap((body) => from(this.db.tenantTx({ tenantId }, (tx) => tx.idempotencyKey.update({ where: { tenantId_key: { tenantId, key } }, data: { statusCode: code, response: (body ?? null) as Prisma.InputJsonValue } }))).pipe(mergeMap(() => of(body)))),
        catchError((err: unknown) => from(this.db.tenantTx({ tenantId }, (tx) => tx.idempotencyKey.deleteMany({ where: { tenantId, key, statusCode: null } })).catch(() => undefined)).pipe(mergeMap(() => throwError(() => err)))),
      );
    }));
  }
}
