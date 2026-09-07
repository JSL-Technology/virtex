import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyRecord } from './idempotency-record.entity';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/**
 * Global so `@Idempotent()` works wherever a transition lives.
 *
 * The decorator applies the interceptor by class, and Nest resolves it from the injector of the
 * module that declares the route. Making this global means a module gains idempotency by decorating
 * a handler, not by remembering to import a module — the same reasoning that put the permission
 * guard in `APP_GUARD`.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyRecord])],
  providers: [IdempotencyInterceptor],
  exports: [IdempotencyInterceptor, TypeOrmModule],
})
export class IdempotencyModule {}
