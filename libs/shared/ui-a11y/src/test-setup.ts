// The same Zone-based environment the applications use, so a directive behaves here as it does
// there. Nothing else: this library injects the platform and Angular's form primitives only.
import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
