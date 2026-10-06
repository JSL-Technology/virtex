import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Building2, Network, Plus, Check } from 'lucide-angular';
import { AuthService } from '../../../../core/services/auth';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { Organization } from '../../../../shared/interfaces/user.interface';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { VxBadgeComponent } from '../../../../shared/components/badge';
import { AddCompanyComponent } from './add-company.component';

/**
 * Settings › My companies: the companies this person belongs to, and the two ways to add one.
 *
 * The company switcher's «Create a new company» and «Manage organizations» led nowhere. They lead
 * here, and «add» asks the one question that decides everything after it:
 *
 * - **A company of this group** — a subsidiary: another legal entity this company controls, with
 *   its own books, consolidated into the group's statements and able to trade intercompany. No
 *   subscription of its own. Created in Company structure, by the company's owners.
 * - **An independent company** — unrelated to this one, with its own subscription: an accountant's
 *   second client, a founder's second business. Paid for at checkout, then opened.
 *
 * Every tenant opens with its own URL (`/e/{slug}`), so moving between them here is navigation.
 */
@Component({
  selector: 'app-organizations-settings',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, HasPermissionDirective, VxBadgeComponent, AddCompanyComponent],
  templateUrl: './organizations.page.html',
  styleUrls: ['./organizations.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrganizationsSettingsPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly router = inject(Router);

  protected readonly BuildingIcon = Building2;
  protected readonly GroupIcon = Network;
  protected readonly PlusIcon = Plus;
  protected readonly CheckIcon = Check;

  /** `list`, the choice of kind, or the independent-company steps. */
  readonly mode = signal<'list' | 'choose' | 'independent'>('list');

  readonly current = computed(() => this.tenancy.organization());
  readonly organizations = computed<Organization[]>(() => {
    const all = this.auth.currentUser()?.organizations ?? [];
    return [...all].sort((a, b) => (a.legalName ?? '').localeCompare(b.legalName ?? ''));
  });

  ngOnInit(): void {
    // `#settings/organizations/new` — from the switcher's «Create a new company».
    if (this.router.url.split('#')[1] === 'settings/organizations/new') {
      this.mode.set('choose');
      void this.router.navigate([], { fragment: 'settings/organizations', replaceUrl: true });
    }
  }

  open(org: Organization): void {
    if (org.id === this.current()?.id) return;
    void this.router.navigateByUrl(this.tenancy.urlFor('/overview', org.slug)).then((ok) => {
      if (ok) this.tenancy.remember(org.slug);
    });
  }

  /** A company of this group: a subsidiary, created where the group's structure is kept. */
  addSubsidiary(): void {
    void this.router.navigate([], { fragment: 'settings/subsidiaries/new' });
  }
}
