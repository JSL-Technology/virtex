import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantConnectionInterceptor } from './tenant-connection.interceptor';
import { patchDataAccessForTenancy } from './tenant-repository.patch';

/**
 * Applied when this file is evaluated, which is before Nest instantiates anything.
 *
 * It used to run in `onModuleInit`, and that is too late by exactly one step: TypeORM's repository
 * providers are constructed during module initialisation, and `Repository`'s constructor assigns
 * `this.manager` directly. An own property shadows a prototype accessor permanently, so every
 * repository created before the patch kept its default manager and quietly ignored the request's
 * connection — which showed up as `new row violates row-level security policy`, the correct answer
 * to a query that never carried the tenant.
 *
 * Importing this module is therefore what installs the patch, and `app.module.ts` imports it.
 */
patchDataAccessForTenancy();

/**
 * Binds every request to its tenant's connection.
 *
 * Registered as an `APP_INTERCEPTOR` for the same reason the permission guard, CSRF and the
 * entitlement check are `APP_GUARD`s: this repository has measured what happens to a control that
 * has to be remembered per endpoint — "4 of 50", "1 of 67", 47 of 76.
 */
@Global()
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: TenantConnectionInterceptor }],
})
export class TenancyModule {}
