import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, from, of, switchMap } from 'rxjs';
import { tap } from 'rxjs/operators';
import { createHash } from 'crypto';
import { IdempotencyRecord } from './idempotency-record.entity';
import { BadRequestError, ConflictError } from '../../i18n/localized.exception';
import { AuthenticatedRequest } from '@virteex/shared/util-auth';

/**
 * Makes a retry safe by remembering the first attempt.
 *
 * ## The order of operations is the design
 *
 * The record is inserted BEFORE the handler runs, and the unique index on
 * `(organization_id, key)` is what arbitrates. Two requests carrying the same key race to insert;
 * one wins and proceeds, the other gets a unique violation and learns that its twin is already
 * running. Deciding this in application code instead — read, then branch, then write — leaves the
 * window between the read and the write open, which is precisely the window a double click lands in.
 *
 * ## The three answers
 *
 * | Situation | Answer |
 * |---|---|
 * | No record | Execute, store the response, return it |
 * | Record completed, same body | Return the stored response. The effect happened once |
 * | Record in progress, or same key with a different body | 409. Never execute |
 *
 * A replayed response is the ORIGINAL response, including its status code. The client cannot tell a
 * retry from the first call, which is the point: it does not have to.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly records: Repository<IdempotencyRecord>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & {
      headers: Record<string, string | undefined>;
      body: unknown;
      method: string;
      route?: { path?: string };
      url: string;
    }>();

    const key = request.headers['idempotency-key'];
    const organizationId = request.user?.organizationId;

    if (!organizationId) {
      // Nothing to scope the key to. The permission layer has already refused anonymous callers on
      // these routes; this only guards against a future route that forgets to.
      throw new BadRequestError('COMMON.IDEMPOTENCY_REQUIRES_SESSION');
    }

    if (!key || key.trim().length === 0) {
      // Refusing is the safe answer. Executing a transition that the client cannot retry means the
      // retry it will eventually make becomes a second posting.
      throw new BadRequestError('COMMON.IDEMPOTENCY_KEY_REQUIRED');
    }

    const endpoint = `${request.method} ${request.route?.path ?? request.url.split('?')[0]}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? {}))
      .digest('hex');

    return from(this.claim(organizationId, key.trim(), endpoint, requestHash)).pipe(
      switchMap((claim) => {
        if (claim.replay) {
          const response = context.switchToHttp().getResponse<{ status: (code: number) => void }>();
          if (claim.record.responseStatus) response.status(claim.record.responseStatus);
          return of(claim.record.responseBody);
        }

        return next.handle().pipe(
          tap({
            next: async (body) => {
              const response = context.switchToHttp().getResponse<{ statusCode?: number }>();
              await this.records.update(
                { id: claim.record.id },
                {
                  status: 'completed',
                  responseStatus: response.statusCode ?? 200,
                  responseBody: body ?? null,
                  completedAt: new Date(),
                },
              );
            },
            error: async () => {
              // A failed attempt must not lock the key: the caller is entitled to fix the cause and
              // try the same logical operation again. Only a COMPLETED attempt is remembered.
              await this.records.delete({ id: claim.record.id }).catch((e) => {
                this.logger.error(`Could not release idempotency key after failure: ${e}`);
              });
            },
          }),
        );
      }),
    );
  }

  /**
   * Take ownership of the key, or report who already has it.
   *
   * The insert is the lock. `ON CONFLICT DO NOTHING` returns nothing when somebody else holds the
   * key, and the row is then read to decide between "replay this" and "refuse this".
   */
  private async claim(
    organizationId: string,
    key: string,
    endpoint: string,
    requestHash: string,
  ): Promise<{ replay: boolean; record: IdempotencyRecord }> {
    const inserted = await this.records
      .createQueryBuilder()
      .insert()
      .into(IdempotencyRecord)
      .values({ organizationId, key, endpoint, requestHash, status: 'in_progress' })
      .orIgnore()
      .returning('*')
      .execute();

    const claimed = inserted.raw?.[0] as IdempotencyRecord | undefined;
    if (claimed) return { replay: false, record: claimed };

    const existing = await this.records.findOne({ where: { organizationId, key } });
    if (!existing) {
      // The holder failed and released the key between our insert and this read. Refusing is the
      // conservative answer: the caller retries and wins the next race cleanly.
      throw new ConflictError('COMMON.IDEMPOTENCY_KEY_IN_PROGRESS');
    }

    if (existing.requestHash !== requestHash || existing.endpoint !== endpoint) {
      // Same name, different request. Neither executing nor replaying is right, so neither happens.
      throw new ConflictError('COMMON.IDEMPOTENCY_KEY_REUSED');
    }

    if (existing.status === 'in_progress') {
      throw new ConflictError('COMMON.IDEMPOTENCY_KEY_IN_PROGRESS');
    }

    return { replay: true, record: existing };
  }
}
