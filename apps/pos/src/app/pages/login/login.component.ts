import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'pos-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <form class="card" [formGroup]="form" (ngSubmit)="submit()">
        <h1>Virtex POS</h1>
        <p class="sub">Sign in to open the till</p>
        @if (error()) {
          <div class="error">{{ error() }}</div>
        }
        <label>Email<input type="email" formControlName="email" autocomplete="username" /></label>
        <label>
          Password
          <input type="password" formControlName="password" autocomplete="current-password" />
        </label>
        <button type="submit" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Signing in…' : 'Sign in' }}
        </button>
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
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  submit(): void {
    if (this.form.invalid || this.loading()) return;
    const { email, password } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set(null);
    this.auth.login(email!, password!).subscribe({
      next: () => {
        // Confirm the session actually resolved (covers 2FA-gated accounts, which do not).
        this.auth.resolveSession().subscribe((ok) => {
          this.loading.set(false);
          if (ok) this.router.navigateByUrl('/');
          else this.error.set('Additional verification required. Finish signing in on the main app.');
        });
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Invalid credentials');
      },
    });
  }
}
