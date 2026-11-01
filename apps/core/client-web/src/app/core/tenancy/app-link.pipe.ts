import { Pipe, PipeTransform, inject } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { ActiveOrganizationService } from './active-organization.service';

/**
 * A link the server sends (`/accounting/journal-entries?status=draft`), as something `routerLink`
 * can follow: in the active company, with its query string as query parameters.
 *
 * Bound as a plain string, `routerLink` percent-encoded the `?` into the path and nothing matched,
 * so every «Resolver» on the closing checklist landed on the home page (QA R3-M11).
 */
@Pipe({ name: 'appLink', standalone: true })
export class AppLinkPipe implements PipeTransform {
  private readonly router = inject(Router);
  private readonly organization = inject(ActiveOrganizationService);

  transform(link: string | null | undefined): UrlTree | null {
    if (!link) return null;
    return this.router.parseUrl(this.organization.urlFor(link));
  }
}
