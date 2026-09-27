import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { resolveErrorKey } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'pos-login',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, ...VX_FORM_A11Y],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <form class="card" [formGroup]="form" (ngSubmit)="submit()">
        <h1>{{ 'apps.pos' | translate }}</h1>
        <p class="sub">{{ 'pos.sign_in_title' | translate }}</p>
        @if (errorKey()) {
          <div class="error">{{ errorKey()! | translate }}</div>
        }
        @if (step() === 'credentials') {
          <label>
            {{ 'pos.email' | translate }}
            <input type="email" formControlName="email" autocomplete="username" />
          </label>
          <label>
            {{ 'pos.password' | translate }}
            <input type="password" formControlName="password" autocomplete="current-password" />
          </label>
          <button type="submit" [disabled]="form.invalid || loading()">
            {{ (loading() ? 'pos.signing_in' : 'pos.sign_in') | translate }}
          </button>
        } @else {
          <p class="sub">{{ 'pos.second_factor_prompt' | translate }}</p>
          <label>
            {{ 'pos.second_factor_code' | translate }}
            <input
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="12"
              [formControl]="code"
            />
          </label>
          <button type="submit" [disabled]="code.invalid || loading()">
            {{ (loading() ? 'pos.signing_in' : 'pos.verify_code') | translate }}
          </button>
        }
      </form>
    </div>
  `,
  styles: [
    `
      .wrap {
        display: grid;
        place-items: center;
        min-height: 100vh;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 360px;
        background: var(--pos-surface);
        border: 1px solid var(--pos-border);
        border-radius: var(--pos-radius);
        padding: 28px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      h1 {
        margin: 0;
        font-size: 1.4rem;
      }
      .sub {
        margin: 0 0 8px;
        color: var(--pos-muted);
        font-size: 0.9rem;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 0.85rem;
        color: var(--pos-muted);
      }
      input {
        background: var(--pos-bg);
        border: 1px solid var(--pos-border);
        border-radius: 8px;
        color: var(--pos-text);
        padding: 10px 12px;
        font-size: 1rem;
      }
      button {
        margin-top: 8px;
        background: var(--pos-primary);
        border: none;
        color: #fff;
        padding: 12px;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
      }
      button:disabled {
        opacity: 0.6;
      }
      .error {
        background: color-mix(in srgb, var(--pos-danger) 18%, transparent);
        color: var(--pos-danger);
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 0.85rem;
      }
    `,
  ],
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  /** A catalogue key rather than a sentence, so the message follows a language switch. */
  readonly errorKey = signal<string | null>(null);

  private readonly translate = inject(TranslateService);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  /** Which half of the sign-in the form is showing. */
  readonly step = signal<'credentials' | 'code'>('credentials');

  readonly code = this.fb.control('', [
    Validators.required,
    Validators.minLength(6),
    Validators.maxLength(12),
  ]);

  submit(): void {
    if (this.loading()) return;
    if (this.step() === 'code') {
      this.submitCode();
      return;
    }
    if (this.form.invalid) return;
    const { email, password } = this.form.getRawValue();
    this.loading.set(true);
    this.errorKey.set(null);
    this.auth.login(email!, password!).subscribe({
      next: (outcome) => {
        if (outcome === 'second-factor') {
          this.loading.set(false);
          this.code.reset('');
          this.step.set('code');
          return;
        }
        this.finishSignIn();
      },
      error: (err) => this.fail(err),
    });
  }

  private submitCode(): void {
    if (this.code.invalid) return;
    this.loading.set(true);
    this.errorKey.set(null);
    this.auth.verifySecondFactor(String(this.code.value ?? '').trim()).subscribe({
      next: () => this.finishSignIn(),
      error: (err) => this.fail(err),
    });
  }

  private finishSignIn(): void {
    this.auth.resolveSession().subscribe((ok) => {
      this.loading.set(false);
      if (ok) this.router.navigateByUrl('/');
      else this.errorKey.set('pos.step_up_required');
    });
  }

  private fail(err: unknown): void {
    this.loading.set(false);
    // Never the server's own sentence: it is written for whoever is reading the logs, and
    // forwarding it is how an English string reached a Spanish till.
    this.errorKey.set(
      resolveErrorKey(err as { status?: number; error?: unknown }, (key) =>
        this.translate.instant(key) !== key,
      ),
    );
  }
}
