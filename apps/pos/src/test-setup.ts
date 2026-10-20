import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

// The till runs zoneless (`provideZonelessChangeDetection`), so its tests do too.
setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
