import { Injectable, effect, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { LocaleStore } from './locale.store';

/**
 * Reload the catalogue when the tenant's country becomes known.
 *
 * The regional patch is chosen by LOCALE, not by language, and the locale is only complete once the
 * session tells the client which country the tenant is in — before that a signed-out visitor is on
 * the language's neutral locale (`es-419`). So the first catalogue a reader gets is the neutral one,
 * and the moment `LocaleStore.locale()` resolves to `es-DO` the table has to be rebuilt to pick up
 * the nineteen Dominican words.
 *
 * `reloadLang` re-runs the loader, which merges the patch. It is cheap: the language chunk is
 * already fetched and cached, so this is an object spread, not a round trip. It happens once per
 * sign-in and once per company switch, which is the only other moment the tenant's country changes.
 */
@Injectable({ providedIn: 'root' })
export class RegionalLocaleEffect {
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LocaleStore);

  /** The locale the loaded table was built for, so an unrelated signal change costs nothing. */
  private applied: string | null = null;

  constructor() {
    effect(() => {
      const locale = this.locale.locale();
      const language = this.translate.currentLang;
      if (!language) return;
      if (this.applied === locale) return;
      this.applied = locale;
      this.translate.reloadLang(language).subscribe({
        // A failed reload leaves the previous, complete table in place. The reader sees neutral
        // wording rather than an empty screen, which is the right way round.
        error: () => console.warn(`[i18n] Could not apply the regional catalogue for ${locale}.`),
      });
    });
  }
}
