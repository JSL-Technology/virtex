import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { I18nService } from './i18n.service';
import { I18nExceptionFilter } from './i18n-exception.filter';
import { LocaleInterceptor } from './locale.interceptor';
import { RequestLocaleMiddleware } from './request-locale';

/**
 * Server-side internationalisation, wired once.
 *
 * `@Global` because the alternative is importing it into all sixty feature modules, and a module
 * that one of them forgets is a module whose errors come back untranslated — a failure nobody
 * sees until a customer reports it.
 *
 * The middleware is applied to every route, including the ones no guard protects: an
 * unauthenticated visitor who cannot sign in is precisely the reader who most needs the message
 * in their own language, and is precisely the one with no stored preference to read.
 */
@Global()
@Module({
  providers: [
    I18nService,
    { provide: APP_FILTER, useClass: I18nExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LocaleInterceptor },
  ],
  exports: [I18nService],
})
export class I18nModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLocaleMiddleware).forRoutes('*');
  }
}
