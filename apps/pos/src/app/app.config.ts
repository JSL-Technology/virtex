import { ApplicationConfig, inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  MissingTranslationHandler,
  TranslateLoader,
  TranslateService,
  TranslateStore,
  provideTranslateService,
} from '@ngx-translate/core';
import { DEFAULT_LANGUAGE } from '@virteex/shared/types';
import {
  LocaleStore,
  VirtexMissingTranslationHandler,
  VirtexTranslateStore,
} from '@virteex/shared/ui-i18n';
import { APP_ROUTES } from './app.routes';
import { apiInterceptor } from './core/api.interceptor';
import { PosTranslateLoader } from './core/i18n/translate-loader';

/**
 * The till's providers.
 *
 * The i18n block is the same shape as the web client's and reads the same generated catalogue,
 * because this application had none at all: every string was an English literal in a template, in a
 * product whose default language is Spanish and whose pilot market is the Dominican Republic, on the
 * one screen a cashier operates rather than an accountant.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(APP_ROUTES),
    provideHttpClient(withFetch(), withInterceptors([apiInterceptor])),

    provideTranslateService({
      loader: { provide: TranslateLoader, useClass: PosTranslateLoader },
      // A key with no entry must not reach a customer-facing till as a dotted identifier.
      missingTranslationHandler: {
        provide: MissingTranslationHandler,
        useClass: VirtexMissingTranslationHandler,
      },
      fallbackLang: DEFAULT_LANGUAGE,
    }),
    // Overrides the store `provideTranslateService` just registered, so every lookup passes through
    // one key normalisation. A later provider for the same token wins.
    { provide: TranslateStore, useClass: VirtexTranslateStore },

    provideAppInitializer(() => {
      const locale = inject(LocaleStore);
      const translate = inject(TranslateService);
      // The language a previous session chose, or the browser's, before any session is known. The
      // tenant's own is applied by `AuthService` once the session resolves.
      translate.use(locale.readInitialLanguage());
    }),
  ],
};
