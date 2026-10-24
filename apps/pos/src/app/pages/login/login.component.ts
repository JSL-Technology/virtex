import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
  LucideAngularModule,
  Store,
  Eye,
  EyeOff,
  Building2,
} from 'lucide-angular';
import { TranslateModule, resolveErrorKey } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { environment } from '../../../environments/environment';
import { AuthService, SignInOutcome } from '../../core/auth.service';

/**
 * Signing in to the till — with the same account as the ERP.
 *
 * There is no separate POS account: whoever's role carries `pos:view` signs in here with their
 * usual email and password (and second factor, if they have one). Someone already signed in to the
 * ERP on this machine arrives signed in. Someone whose role does not include the point of sale is
 * told so plainly, rather than shown a till that refuses every button.
 */
@Component({
  selector: 'pos-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    LucideAngularModule,
    TranslateModule,
    ...VX_FORM_A11Y,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <section class="panel">
        <div class="brand">
          <span class="mark" aria-hidden="true"
            ><lucide-icon [img]="StoreIcon" size="22"
          /></span>
          <div>
            <h1>{{ 'apps.pos' | translate }}</h1>
            <p class="sub">{{ 'pos.sign_in_title' | translate }}</p>
          </div>
        </div>

        @if (notice(); as n) {
          <div
            class="alert"
            [class.alert-warning]="n === 'pos.no_access'"
            [class.alert-info]="n !== 'pos.no_access'"
            role="status"
          >
            {{ n | translate }}
          </div>
        }
        @if (errorKey(); as e) {
          <div class="alert alert-error" role="alert">{{ e | translate }}</div>
        }

        @if (step() === 'credentials') {
          <form
            class="form"
            [formGroup]="form"
            (ngSubmit)="submit()"
            novalidate
          >
            <label class="field">
              {{ 'pos.email' | translate }}
              <input
                type="email"
                formControlName="email"
                autocomplete="username"
                inputmode="email"
                data-testid="login-email"
              />
            </label>
            <label class="field">
              {{ 'pos.password' | translate }}
              <span class="password">
                <input
                  [type]="showPassword() ? 'text' : 'password'"
                  formControlName="password"
                  autocomplete="current-password"
                  data-testid="login-password"
                />
                <button
                  type="button"
                  class="icon-btn"
                  (click)="showPassword.set(!showPassword())"
                  [attr.aria-label]="
                    (showPassword() ? 'pos.hide_password' : 'pos.show_password')
                      | translate
                  "
                  [attr.aria-pressed]="showPassword()"
                >
                  <lucide-icon
                    [img]="showPassword() ? EyeOffIcon : EyeIcon"
                    size="18"
                    aria-hidden="true"
                  />
                </button>
              </span>
            </label>
            <button
              type="submit"
              class="btn btn-primary btn-lg"
              [disabled]="loading()"
              data-testid="login-submit"
            >
              {{ (loading() ? 'pos.signing_in' : 'pos.sign_in') | translate }}
            </button>
          </form>
        } @else {
          <form class="form" (ngSubmit)="submit()" novalidate>
            <p class="sub">{{ 'pos.second_factor_prompt' | translate }}</p>
            <label class="field">
              {{ 'pos.second_factor_code' | translate }}
              <input
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="12"
                [formControl]="code"
              />
            </label>
            <button
              type="submit"
              class="btn btn-primary btn-lg"
              [disabled]="code.invalid || loading()"
            >
              {{
                (loading() ? 'pos.signing_in' : 'pos.verify_code') | translate
              }}
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              (click)="backToCredentials()"
            >
              {{ 'pos.use_another_account' | translate }}
            </button>
          </form>
        }

        <footer class="foot">
          <p>{{ 'pos.same_account_hint' | translate }}</p>
          <a
            class="btn btn-ghost btn-sm"
            [href]="erpUrl"
            data-testid="login-erp-link"
          >
            <lucide-icon [img]="ErpIcon" size="16" aria-hidden="true" />
            {{ 'pos.back_office' | translate }}
          </a>
        </footer>
      </section>
    </main>
  `,
  styles: [
    `
      .wrap {
        min-height: 100vh;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: 24px 16px;
        background:
          radial-gradient(
            900px 500px at 15% -10%,
            color-mix(in srgb, var(--pos-primary) 22%, transparent),
            transparent 60%
          ),
          radial-gradient(
            700px 500px at 110% 110%,
            color-mix(in srgb, #7c5cff 18%, transparent),
            transparent 60%
          ),
          var(--pos-bg);
      }
      .panel {
        width: 100%;
        max-width: 420px;
        background: var(--pos-surface);
        border: 1px solid var(--pos-border);
        border-radius: 20px;
        padding: 32px 28px 22px;
        display: flex;
        flex-direction: column;
        gap: 18px;
        box-shadow: var(--pos-shadow-lg);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .mark {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        border-radius: 14px;
        background: linear-gradient(135deg, var(--pos-primary), #7c5cff);
        color: #fff;
      }
      h1 {
        margin: 0;
        font-size: 1.45rem;
      }
      .sub {
        margin: 2px 0 0;
        color: var(--pos-muted);
        font-size: 0.92rem;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .password {
        position: relative;
        display: flex;
      }
      .password input {
        flex: 1;
        padding-right: 48px;
      }
      .password .icon-btn {
        position: absolute;
        right: 4px;
        top: 50%;
        transform: translateY(-50%);
      }
      .alert {
        margin: 0;
      }
      .foot {
        border-top: 1px solid var(--pos-border);
        padding-top: 14px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        text-align: center;
      }
      .foot p {
        margin: 0;
        color: var(--pos-faint);
        font-size: 0.82rem;
      }
      .foot a {
        text-decoration: none;
      }
    `,
  ],
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  protected readonly StoreIcon = Store;
  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;
  protected readonly ErpIcon = Building2;
  protected readonly erpUrl = environment.erpUrl;

  readonly loading = signal(false);
  readonly showPassword = signal(false);
  /** A catalogue key rather than a sentence, so the message follows a language switch. */
  readonly errorKey = signal<string | null>(null);
  /** Why the cashier is here: their role lacks the till, or their session ran out. */
  readonly notice = signal<string | null>(
    LoginComponent.noticeFor(this.route.snapshot.queryParamMap.get('reason')),
  );

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  /** Which half of the sign-in the form is showing. */
  readonly step = signal<'credentials' | 'code'>('credentials');

  readonly code = this.fb.nonNullable.control('', [
    Validators.required,
    Validators.minLength(6),
    Validators.maxLength(12),
  ]);

  constructor() {
    // The sign-in is a state-changing request: it needs the CSRF cookie the session bootstrap sets.
    this.auth.primeCsrf().subscribe();
  }

  submit(): void {
    if (this.loading()) return;
    if (this.step() === 'code') {
      this.submitCode();
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorKey.set('pos.credentials_required');
      return;
    }
    const { email, password } = this.form.getRawValue();
    this.loading.set(true);
    this.errorKey.set(null);
    this.notice.set(null);
    this.auth.login(email.trim(), password).subscribe({
      next: (outcome) => this.settle(outcome),
      error: (err) => this.fail(err),
    });
  }

  backToCredentials(): void {
    this.step.set('credentials');
    this.code.reset('');
    this.errorKey.set(null);
  }

  private submitCode(): void {
    if (this.code.invalid) return;
    this.loading.set(true);
    this.errorKey.set(null);
    this.auth.verifySecondFactor(this.code.value.trim()).subscribe({
      next: (outcome) => this.settle(outcome),
      error: (err) => this.fail(err),
    });
  }

  private settle(outcome: SignInOutcome): void {
    this.loading.set(false);
    if (outcome === 'second-factor') {
      this.code.reset('');
      this.step.set('code');
      return;
    }
    if (outcome === 'no-access') {
      this.step.set('credentials');
      this.form.controls.password.reset('');
      this.notice.set('pos.no_access');
      return;
    }
    void this.router.navigateByUrl('/');
  }

  private fail(err: unknown): void {
    this.loading.set(false);
    // Never the server's own sentence: it is written for whoever is reading the logs, and
    // forwarding it is how an English string reached a Spanish till.
    this.errorKey.set(
      resolveErrorKey(
        err as { status?: number; error?: unknown },
        (key) => this.translate.instant(key) !== key,
      ),
    );
  }

  private static noticeFor(reason: string | null): string | null {
    if (reason === 'no_access') return 'pos.no_access';
    if (reason === 'expired') return 'pos.session_expired';
    return null;
  }
}
