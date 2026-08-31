import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_ENDONYMS,
  LanguageCode,
  LocaleContextContract,
  SUPPORTED_LANGUAGES,
  matchLanguage,
} from '@virteex/shared/types';
import { LocaleStore } from '../i18n/locale.store';
import { UsersService } from '../api/users.service';

/**
 * The policy layer over {@link LocaleStore}: who decides the language, and when it is persisted.
 *
 * ## The two bugs this file exists to end
 *
 * **1. The preference was write-only.** The old effect sent `PATCH /users/profile` whenever the
 * language changed and differed from the signed-in user's `preferredLanguage`, but nothing ever
 * *read* `preferredLanguage` when a session was restored — the initial language came from
 * `localStorage`, then the browser, then Spanish. So a user whose profile said `en`, opening the
 * application in a private window or on a second machine, resolved to Spanish and the effect
 * immediately overwrote their saved preference with that guess. The server's answer was destroyed
 * by the client's assumption on every visit. Now the session is the authority
 * ({@link applySessionPreference}) and the client only writes when the reader actually chooses
 * ({@link setLanguage}).
 *
 * **2. Two switchers, two behaviours.** The auth footer called `translate.use()` directly and
 * wrote its own `localStorage` key, so the choice did not survive a reload, did not update
 * `<html lang>`, and left this service's signal stale — after which the route guard's
 * `setLanguage` short-circuited on `lang !== current` and never restored anything. There is now
 * exactly one way to change the language and it goes through here.
 *
 * ## Dependency direction
 *
 * This injects `UsersService` (an HTTP client) and `LocaleStore` (platform only). It deliberately
 * does NOT inject `AuthService`: `AuthService` needs the language, to send a signed-out user to
 * the right sign-in page, and the previous arrangement made that a cycle. Authentication pushes
 * the session in via {@link applySessionPreference} and {@link detachSession} instead.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly store = inject(LocaleStore);
  private readonly translate = inject(TranslateService);
  private readonly users = inject(UsersService);

  /** The active interface language. */
  readonly currentLanguage = this.store.language;

  /** Regional formatting locale (`es-DO`, `en-US`, `pt-BR`). */
  readonly currentLocale = this.store.locale;

  readonly direction = this.store.direction;

  /** The languages this build can render, each named in its own language. */
  readonly availableLanguages = SUPPORTED_LANGUAGES.map((code) => ({
    code,
    label: LANGUAGE_ENDONYMS[code],
  }));

  /**
   * The signed-in user, when there is one. Held here rather than read from `AuthService` so the
   * dependency points one way; `AuthService` calls {@link applySessionPreference} on every event
   * that establishes or refreshes a session.
   */
  private readonly session = signal<{ userId: string; preferred: LanguageCode | null } | null>(null);

  /** True once a catalogue has been loaded, so `instant()` is safe. */
  private readonly _ready = signal(false);
  readonly ready = this._ready.asReadonly();

  /** Backwards-compatible alias. Templates and older call sites read `currentLang()`. */
  readonly currentLang = computed(() => this.store.language());

  constructor() {
    this.translate.addLangs([...SUPPORTED_LANGUAGES]);
    this.translate.setFallbackLang(DEFAULT_LANGUAGE);

    // One effect, one job: keep the translation runtime pointed at the store's language. Storage,
    // `<html lang>` and direction are the store's business and are handled there, so there is no
    // second place that can disagree about what the language is.
    effect(() => {
      const language = this.store.language();
      untracked(() => {
        this.translate.use(language).subscribe({
          next: () => this._ready.set(true),
          error: () => this._ready.set(true),
        });
      });
    });
  }

  /**
   * Load the active catalogue before the first screen is painted.
   *
   * Called from `provideAppInitializer`. Without it the first navigation can run
   * `TranslateService.instant()` — which the title strategy and the error handler both do —
   * against an empty table, and those calls return the key rather than waiting.
   */
  async preload(): Promise<void> {
    try {
      await firstValueFrom(this.translate.use(this.store.language()));
    } finally {
      this._ready.set(true);
    }
  }

  /**
   * Change the language because the reader asked for it.
   *
   * This is the only entry point that persists: an explicit choice is remembered on the device
   * and, when there is a session, saved to the profile so the next device starts there too.
   */
  setLanguage(language: string): void {
    const matched = matchLanguage(language);
    if (!matched || matched === this.store.language()) return;

    this.store.setLanguage(matched);
    this.persistToProfile(matched);
  }

  /**
   * Adopt the language a route asked for (`/en/auth/login`).
   *
   * A language-prefixed URL is an explicit request — somebody was sent that link, or bookmarked
   * it — so it is treated like a choice and remembered. It is not, however, allowed to overwrite
   * a signed-in user's stored profile preference: the URL says what to render now, the profile
   * says what they chose, and a shared link must not silently rewrite somebody's account setting.
   */
  applyRouteLanguage(language: string): void {
    const matched = matchLanguage(language);
    if (!matched || matched === this.store.language()) return;
    this.store.setLanguage(matched);
  }

  /**
   * The session has been established or refreshed.
   *
   * The user's stored preference wins over whatever the device guessed, because it is the only
   * value that represents a decision rather than an inference. When the user has no stored
   * preference — a fresh account, or one created before they were asked — the language currently
   * on screen is written to the profile, so the guess becomes a decision exactly once instead of
   * being re-made on every device.
   */
  applySessionPreference(
    userId: string,
    preferred: string | null | undefined,
    localeContext?: LocaleContextContract | null,
  ): void {
    const matched = matchLanguage(preferred ?? null);
    this.session.set({ userId, preferred: matched });
    this.store.setTenantContext(localeContext ?? null);

    if (matched) {
      this.store.setLanguage(matched);
      return;
    }

    // No stored preference. Adopt the current one so the account has an answer from now on.
    this.persistToProfile(this.store.language());
  }

  /** The session ended. The device keeps its language; the profile is no longer ours to write. */
  detachSession(): void {
    this.session.set(null);
    this.store.setTenantContext(null);
  }

  /**
   * Save the preference to the profile, best effort.
   *
   * A failure here is not shown and not retried: the language on screen is already correct, and
   * an error toast about a background preference save is noise at the moment somebody is simply
   * reading their own interface in their own language. The next explicit change tries again.
   */
  private persistToProfile(language: LanguageCode): void {
    const session = untracked(this.session);
    if (!session || session.preferred === language) return;

    this.session.set({ ...session, preferred: language });
    this.users.updateProfile({ preferredLanguage: language }).subscribe({
      error: () => {
        // Roll the local record back so a later attempt is not skipped as "already saved".
        const current = untracked(this.session);
        if (current) this.session.set({ ...current, preferred: session.preferred });
      },
    });
  }
}
