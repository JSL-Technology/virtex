import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, isDevMode, APP_INITIALIZER, inject } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHighcharts } from 'highcharts-angular';
import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';
// import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { CustomTranslateLoader } from './core/i18n/custom-translate-loader';

// import { RECAPTCHA_V3_SITE_KEY, RecaptchaV3Module } from 'ng-recaptcha';
// import { environment } from './environments/environment';

import { APP_ROUTES } from './app.routes';
import { RECAPTCHA_SETTINGS, RECAPTCHA_V3_SITE_KEY, RecaptchaSettings, RecaptchaV3Module } from 'ng-recaptcha-19';
import { environment } from '../environments/environment';
import { ThemeService } from './core/services/theme';
import { AuthService } from './core/services/auth';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { provideServiceWorker } from '@angular/service-worker';
import { API_URL } from './core/tokens/api-url.token';

const CORE_PROVIDERS = [
  {
      provide: APP_INITIALIZER,
      useFactory: () => {
          const authService = inject(AuthService);
          return () => authService.checkAuthStatus();
      },
      multi: true
  },
  { provide: API_URL, useValue: environment.apiUrl || 'http://localhost:3000/api/v1' },
  provideBrowserGlobalErrorListeners(),
  provideZonelessChangeDetection(),
  provideRouter(
    APP_ROUTES,
    withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'top' }),
  ),
  provideHttpClient(),
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
    loader: {
      provide: TranslateLoader,
      useClass: CustomTranslateLoader
    },
    fallbackLang: 'es',
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
        theme: themeService.activeTheme(),
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
    provideHttpClient(withInterceptors([authInterceptor]), withFetch()), provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000'
          }), provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000'
          }),
  ],
};
