import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, AlertCircle, RefreshCw, Check, Bell } from 'lucide-angular';
import { CountryService, SupportedCountry } from '../../../core/services/country.service';
import { CountryNamesService } from '../../../core/i18n/countries';
import { GeoLocationService } from '../../../core/services/geo-location.service';
import { LanguageService } from '../../../core/services/language';
import { visitorRegion } from '../../../core/i18n/visitor-region';
import { CountryFlagComponent } from '../../../shared/components/country-flag/country-flag.component';
import { AuthButtonComponent } from '../components/auth-button/auth-button.component';
import { NotificationService } from '../../../core/services/notification';
import { environment } from '../../../../environments/environment';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

/** One choice on the picker. */
interface CountryChoice {
  code: string;
  name: string;
}

/**
 * «Elige tu país» — the first screen of signup (QA C-06, A-13).
 *
 * The signup used to infer the country and never ask. The "Sign up" link was built from the
 * browser's region, so a visitor whose browser said `en-GB`, `pt-PT` or `fr-FR` was sent to
 * `/…/gb/auth/register`, which the product does not serve — and from there either to a Dominican
 * form or, when the country list failed to load, back to the sign-in page with no word of
 * explanation. A signup button that loops silently to sign-in loses the customer at the door.
 *
 * Now the country is a question, answered here:
 *
 *   - every market the product serves, with its flag and its name in the reader's language, the
 *     visitor's likely one marked as a suggestion rather than chosen for them;
 *   - when the list cannot be loaded, that is said, with a retry — never a redirect;
 *   - when the visitor's country is not served (or they arrived from a link naming one), that is
 *     said too, with "notify me" so the visit is not simply lost.
 *
 * Whatever query string the visitor arrived with (the email magic link's `email_token`, the
 * social sign-up hand-off) is carried to the chosen country's form.
 */
@Component({
  selector: 'app-country-picker',
  standalone: true,
  imports: [
    TranslateModule,
    FormsModule,
    RouterLink,
    LucideAngularModule,
    CountryFlagComponent,
    AuthButtonComponent,
    ...VX_FORM_A11Y,
  ],
  templateUrl: './country-picker.page.html',
  styleUrls: ['./country-picker.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CountryPickerPage implements OnInit {
  private readonly countryService = inject(CountryService);
  private readonly names = inject(CountryNamesService);
  private readonly geo = inject(GeoLocationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly errorText = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  readonly language = inject(LanguageService);

  protected readonly AlertCircleIcon = AlertCircle;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly CheckIcon = Check;
  protected readonly BellIcon = Bell;

  readonly state = signal<'loading' | 'ready' | 'failed'>('loading');
  private readonly supported = signal<SupportedCountry[]>([]);

  /** The country the visitor probably is in: geolocation first, the browser's region otherwise. */
  readonly detected = signal<string | null>(visitorRegion());

  /** A country the URL named and the product does not serve (`?unsupported=GB`). */
  readonly unsupported = signal<string | null>(null);

  /** The country whose configuration failed to load when the visitor tried it (`?failed=MX`). */
  readonly failedCountry = signal<string | null>(null);

  readonly choices = computed<CountryChoice[]>(() => {
    const collator = new Intl.Collator(this.language.currentLocale(), { sensitivity: 'base' });
    return this.supported()
      .map((c) => ({ code: c.countryCode, name: this.names.nameOf(c.countryCode) || c.name }))
      .sort((a, b) => collator.compare(a.name, b.name));
  });

  /** The detected country, when it is one the product serves. Listed first and marked. */
  readonly suggested = computed<CountryChoice | null>(() => {
    const code = this.detected();
    return this.choices().find((c) => c.code === code) ?? null;
  });

  /** True when the visitor appears to be somewhere the product does not sell yet. */
  readonly visitorNotServed = computed(() => {
    const code = this.unsupported() ?? this.detected();
    return this.state() === 'ready' && !!code && !this.choices().some((c) => c.code === code);
  });

  /** Every country, for "notify me when you open in…", minus the ones already open. */
  readonly waitlistOptions = computed(() => {
    const served = new Set(this.supported().map((c) => c.countryCode));
    return this.names.options().filter((o) => !served.has(o.code));
  });

  // ── Waitlist ────────────────────────────────────────────────────────────────
  waitlistCountry = '';
  waitlistEmail = '';
  readonly waitlistState = signal<'idle' | 'sending' | 'done' | 'error'>('idle');
  /** A finished sentence: the server's resolved message, or our own already translated. */
  readonly waitlistError = signal<string | null>(null);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const unsupported = (params.get('unsupported') ?? '').toUpperCase();
    this.unsupported.set(/^[A-Z]{2}$/.test(unsupported) ? unsupported : null);
    const failed = (params.get('failed') ?? '').toUpperCase();
    this.failedCountry.set(/^[A-Z]{2}$/.test(failed) ? failed : null);

    this.geo.getGeoLocation().subscribe((res) => {
      if (res?.country && /^[A-Za-z]{2}$/.test(res.country)) this.detected.set(res.country.toUpperCase());
      this.prefillWaitlist();
    });
    this.load();
  }

  load(): void {
    this.state.set('loading');
    this.countryService.getSupportedCountries().subscribe({
      next: (countries) => {
        this.supported.set(countries);
        this.state.set(countries.length ? 'ready' : 'failed');
        this.prefillWaitlist();
      },
      error: () => this.state.set('failed'),
    });
  }

  /** Retry after a failure: the list is cached once loaded, so a failed request is dropped first. */
  retry(): void {
    this.countryService.resetSupportedCountries();
    this.failedCountry.set(null);
    this.load();
  }

  nameOf(code: string | null): string {
    return code ? this.names.nameOf(code) : '';
  }

  /** Go to the chosen market's form, carrying any query string the visitor arrived with. */
  choose(code: string): void {
    const queryParams = { ...this.route.snapshot.queryParams };
    delete queryParams['unsupported'];
    delete queryParams['failed'];
    void this.router.navigate(['/', this.language.currentLang(), code.toLowerCase(), 'auth', 'register'], {
      queryParams,
    });
  }

  private prefillWaitlist(): void {
    if (this.waitlistCountry) return;
    const candidate = this.unsupported() ?? this.detected();
    if (candidate && !this.supported().some((c) => c.countryCode === candidate)) {
      this.waitlistCountry = candidate;
    }
  }

  joinWaitlist(): void {
    if (!this.waitlistCountry || !/^\S+@\S+\.\S+$/.test(this.waitlistEmail.trim())) {
      this.waitlistError.set(this.translate.instant('auth.country_picker.waitlist_invalid'));
      this.waitlistState.set('error');
      return;
    }
    this.waitlistState.set('sending');
    this.waitlistError.set(null);
    this.http
      .post(`${environment.apiUrl}/legal/market-waitlist`, {
        email: this.waitlistEmail.trim(),
        countryCode: this.waitlistCountry,
        language: this.language.currentLang(),
      })
      .subscribe({
        next: () => this.waitlistState.set('done'),
        error: (err) => {
          this.waitlistError.set(this.errorText.httpErrorMessage(err, 'auth.country_picker.waitlist_failed'));
          this.waitlistState.set('error');
        },
      });
  }
}
