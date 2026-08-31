import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, isDevMode, provideAppInitializer, inject } from '@angular/core';
import { provideRouter, withInMemoryScrolling, TitleStrategy } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHighcharts } from 'highcharts-angular';
import {
  MissingTranslationHandler,
  provideTranslateService,
  TranslateLoader,
} from '@ngx-translate/core';
import { DEFAULT_LANGUAGE } from '@virteex/shared/types';
import { TranslatedTitleStrategy } from './core/i18n/page-title.strategy';
import { LazyTranslateLoader } from './core/i18n/translate-loader';
import { VirtexMissingTranslationHandler } from './core/i18n/missing-translation.handler';
import { LanguageService } from './core/services/language';

// import { RECAPTCHA_V3_SITE_KEY, RecaptchaV3Module } from 'ng-recaptcha';
// import { environment } from '../environments/environment';

import { APP_ROUTES } from './app.routes';
import { RECAPTCHA_SETTINGS, RECAPTCHA_V3_SITE_KEY, RecaptchaSettings, RecaptchaV3Module } from 'ng-recaptcha-19';
import { environment } from '../environments/environment';
import { ThemeService } from './core/services/theme';
import { AuthService } from './core/services/auth';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { provideServiceWorker } from '@angular/service-worker';
import { API_URL } from './core/tokens/api-url.token';

const CORE_PROVIDERS = [
  // Resolve the session before the first route is evaluated, so the guards never see a "pending"
  // state and no screen is painted for the wrong audience. `provideAppInitializer` replaces the
  // deprecated APP_INITIALIZER multi-provider (Angular 19+); the returned observable is awaited.
  //
  // This is the ONLY place the session is fetched. `resolveSession()` memoises its result, so
  // every guard on every route afterwards reads that same answer without a request.
  // The active message catalogue is loaded before the first route is evaluated. `instant()` is
  // synchronous and returns the KEY when the table is empty, and both the title strategy and the
  // HTTP error handler call it — so without this the first screen after a cold start can show
  // `AUTH.TITLES.LOGIN` in the browser tab.
  provideAppInitializer(() => inject(LanguageService).preload()),
  provideAppInitializer(() => inject(AuthService).resolveSession()),
  { provide: API_URL, useValue: environment.apiUrl || 'http://localhost:3000/api/v1' },
  provideBrowserGlobalErrorListeners(),
  provideZonelessChangeDetection(),
  // One title strategy: route titles are translation keys, composed with APP_TITLE.
  { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
  provideRouter(
    APP_ROUTES,
    withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'top' }),
  ),
  provideAnimations(),
];

const CHARTS_PROVIDERS = [
  provideHighcharts({
    instance: () => import('highcharts/esm/highcharts').then(m => m.default),
    modules: () => ([
      import('highcharts/esm/highcharts-more'),
      import('highcharts/esm/modules/accessibility'),
      import('highcharts/esm/modules/exporting'),
      import('highcharts/esm/themes/sunset'),
    ]),
    options: {
      title: { style: {} },
      legend: { enabled: false },
    },
  }),
];

const I18N_PROVIDERS = [
  provideTranslateService({
    loader: { provide: TranslateLoader, useClass: LazyTranslateLoader },
    // A key with no entry must not reach the screen as a dotted identifier. See the handler.
    missingTranslationHandler: {
      provide: MissingTranslationHandler,
      useClass: VirtexMissingTranslationHandler,
    },
    fallbackLang: DEFAULT_LANGUAGE,
  }),
];

const RECAPTCHA_PROVIDERS = [
  RecaptchaV3Module,
  { provide: RECAPTCHA_V3_SITE_KEY, useValue: environment.recaptcha.siteKey },
  {
    provide: RECAPTCHA_SETTINGS,
    // Cambia de 'useValue' a 'useFactory'
    useFactory: (themeService: ThemeService): RecaptchaSettings => {
      return {
        siteKey: environment.recaptcha.siteKey,
        size: 'invisible',
        badge: 'bottomleft', // Cambia esto si necesitas otro badge
        // Ahora el tema es dinámico basado en el servicio
        theme: themeService.appliedTheme(),
      };
    },
    deps: [ThemeService] // Declara la dependencia a inyectar
  }
];

export const appConfig: ApplicationConfig = {
  providers: [
    ...CORE_PROVIDERS,
    ...CHARTS_PROVIDERS,
    ...I18N_PROVIDERS,
    ...RECAPTCHA_PROVIDERS,
    provideHttpClient(withInterceptors([authInterceptor]), withFetch()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
