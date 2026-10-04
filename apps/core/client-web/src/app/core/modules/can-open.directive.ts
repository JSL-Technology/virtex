import { Directive, computed, inject, input } from '@angular/core';
import { AuthService } from '../services/auth';
import { pathWithoutOrganization } from '../tenancy/active-organization.service';
import { requiredPermissionsFor } from './module-manifest';
import { resolveRoute } from './module-registry';

/**
 * Show a link only to whoever may open what it opens (QA M-01).
 *
 * A Member, whose role reads invoices, was offered «Nueva factura de venta»; the server refused
 * the draft and the screen behind it said "access denied". The permission of every screen is
 * already declared once, in the module manifest that builds the routes, so the link asks that
 * declaration rather than repeating a permission string in each template — where it would drift.
 *
 * Applied to every list's action links (`a[listActions]`) and, explicitly, wherever a link or
 * button leads to a screen (`[vxCanOpen]="'/invoices/new'"`). The server stays the authority; this
 * only stops the interface offering a door it would slam. An unknown path is left visible: the
 * router's own guard answers it, and hiding it would hide a broken link.
 */
@Directive({
  selector: 'a[listActions], [vxCanOpen], [vxRequires]',
  standalone: true,
  host: {
    '[hidden]': '!allowed()',
    '[attr.aria-hidden]': 'allowed() ? null : "true"',
  },
})
export class CanOpenDirective {
  private readonly auth = inject(AuthService);

  /** Read from the same binding the router uses, so the two cannot point at different places. */
  readonly routerLink = input<string | readonly unknown[] | null | undefined>(undefined);
  /** An explicit target, for a button that navigates in code. */
  readonly vxCanOpen = input<string | null | undefined>(undefined);
  /**
   * The permission an in-place action needs — "New warehouse" opens a row, not a screen, so there
   * is no route to ask. The same string the API's `@HasPermission` declares for that write.
   */
  readonly vxRequires = input<string | null | undefined>(undefined);

  protected readonly allowed = computed(() => {
    const required = this.vxRequires();
    if (required) return this.auth.hasPermissions([required]);
    const target = this.vxCanOpen() ?? pathOf(this.routerLink());
    if (!target) return true;
    const match = resolveRoute(pathWithoutOrganization(target));
    if (!match) return true;
    return this.auth.hasPermissions(requiredPermissionsFor(match.entry.route.permission));
  });
}

function pathOf(link: string | readonly unknown[] | null | undefined): string | null {
  if (!link) return null;
  if (typeof link === 'string') return link;
  const segments = link.filter((part) => typeof part === 'string' || typeof part === 'number');
  if (segments.length !== link.length) return null; // a query or outlet object: not a plain path
  return segments.join('/').replace(/\/+/g, '/');
}
