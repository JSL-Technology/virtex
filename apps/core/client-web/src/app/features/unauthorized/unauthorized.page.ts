import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule, ShieldAlert, Mail } from 'lucide-angular';
import { AuthService } from '../../core/services/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-unauthorized-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink, TranslateModule],
  templateUrl: './unauthorized.page.html',
  styleUrls: ['./unauthorized.page.scss']
})
export class UnauthorizedPage {
  private readonly translate = inject(TranslateService);
  protected readonly ShieldAlertIcon = ShieldAlert;
  protected readonly MailIcon = Mail;

  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);

  public attemptedUrl$: Observable<string | null> = this.route.queryParamMap.pipe(
    map(params => params.get('url'))
  );

  currentUser = this.authService.currentUser;

  /**
   * A pre-filled message asking for access, in the reader's language.
   *
   * The subject and body were Spanish template literals, so an English-speaking user wrote to
   * their administrator in Spanish without being asked.
   *
   * There is deliberately **no recipient**. It used to be `admin@example.com` — a placeholder
   * domain reserved by the IETF precisely so it can never receive mail, which made this button
   * look like it did something and send the request nowhere. Which address is the right one
   * depends on the tenant, and the client has no way to know it: the signed-in user carries no
   * organisation contact. Opening the composer with the message written and the To: field empty
   * is the honest version — the reader knows who their administrator is, and nothing is lost in
   * a mailbox that does not exist.
   */
  constructMailtoLink(attemptedUrl: string | null): string {
    const user = this.currentUser();
    const route = attemptedUrl || this.translate.instant('UNAUTHORIZED.PROTECTED_ROUTE');
    const subject = this.translate.instant('UNAUTHORIZED.REQUEST_SUBJECT', { route });
    const body = this.translate.instant('UNAUTHORIZED.REQUEST_BODY', {
      name: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim(),
      email: user?.email ?? '',
      url: `${window.location.origin}${attemptedUrl || '/'}`,
    });

    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
}