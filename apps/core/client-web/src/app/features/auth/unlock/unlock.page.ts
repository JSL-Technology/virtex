import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, CheckCircle, AlertCircle, Loader } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth';
import { AppError } from '../../../core/services/error-handler.service';
import { LanguageService } from '../../../core/services/language';
import { BrandLogo } from '../../../shared/components/brand-logo/brand-logo';

/**
 * Where the lockout email's link lands (QA C-09).
 *
 * Reads the token from the URL FRAGMENT — like the password-reset page, so it never reaches a
 * server log or a `Referer` — clears it from the address bar, and redeems it straight away:
 * there is nothing to fill in, and a button would only be one more step between a locked-out
 * person and their account.
 */
@Component({
  selector: 'app-unlock-account',
  standalone: true,
  imports: [TranslateModule, RouterLink, LucideAngularModule, BrandLogo],
  templateUrl: './unlock.page.html',
  styleUrls: ['./unlock.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnlockAccountPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  readonly languageService = inject(LanguageService);

  protected readonly CheckIcon = CheckCircle;
  protected readonly AlertIcon = AlertCircle;
  protected readonly LoaderIcon = Loader;

  readonly state = signal<'working' | 'done' | 'error'>('working');
  /** A catalogue key: the server's (`auth.unlock_link_invalid_or_expired`) or our own. */
  readonly errorKey = signal<string>('auth.unlock_link_invalid_or_expired');

  ngOnInit(): void {
    const fragment = this.route.snapshot.fragment ?? '';
    const match = fragment.match(/(?:^|&)token=([^&]+)/);
    const token = match ? decodeURIComponent(match[1]) : null;
    // Out of the address bar and the history entry before anything else happens.
    void this.router.navigate([], { relativeTo: this.route, fragment: undefined, replaceUrl: true });

    if (!token) {
      this.errorKey.set('login.unlock.missing_token');
      this.state.set('error');
      return;
    }

    this.auth.unlockAccount(token).subscribe({
      next: () => this.state.set('done'),
      error: (err: AppError) => {
        this.errorKey.set(err?.messageKey || 'auth.unlock_link_invalid_or_expired');
        this.state.set('error');
      },
    });
  }
}
