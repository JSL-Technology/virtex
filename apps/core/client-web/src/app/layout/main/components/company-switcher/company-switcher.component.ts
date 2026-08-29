import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Building, Check, ChevronsUpDown, Plus, Settings, Search } from 'lucide-angular';
import { ClickOutsideDirective } from '../../../../shared/directives/click-outside.directive';
import { AuthService } from '../../../../core/services/auth';
import { Organization } from '../../../../shared/interfaces/user.interface';
import { TabStateService } from '../../../../core/tabs/tab-state.service';
import { TabPersistenceService } from '../../../../core/tabs/tab-persistence.service';
import { OrganizationService } from '../../../../shared/service/organization.service';

@Component({
  selector: 'app-company-switcher',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule, ClickOutsideDirective],
  templateUrl: './company-switcher.component.html',
  styleUrls: ['./company-switcher.component.scss']
})
export class CompanySwitcherComponent {
  private authService = inject(AuthService);
  private tabState = inject(TabStateService);
  private tabPersistence = inject(TabPersistenceService);
  private organizationService = inject(OrganizationService);

  isOpen = signal(false);
  searchQuery = signal('');
  switching = signal(false);
  switchError = signal<string | null>(null);

  currentOrg = computed(() => this.authService.currentUser()?.organization ?? null);

  /**
   * Tenants the user can actually switch into.
   *
   * This used to render three hardcoded placeholders ('Virtex Corp', 'Acme Industries',
   * 'Globex Corporation') because the API never exposed the membership list — even though the
   * backend already resolves it from the `user_organizations` join table on every authenticated
   * request. It is now driven by `user.organizations`, which always contains at least the active
   * tenant, so the switcher shows real data instead of fiction.
   */
  private accessibleOrganizations = computed<Organization[]>(
    () => this.authService.currentUser()?.organizations ?? [],
  );

  filteredOrganizations = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const current = this.currentOrg();
    const all = this.accessibleOrganizations();

    // Defensive: keep the active tenant visible even if the membership list is incomplete.
    const list = current && !all.some(o => o.id === current.id) ? [current, ...all] : all;

    if (!query) return list;
    return list.filter(org => org.legalName?.toLowerCase().includes(query));
  });

  protected readonly BuildingIcon = Building;
  protected readonly CheckIcon = Check;
  protected readonly ChevronsUpDownIcon = ChevronsUpDown;
  protected readonly PlusIcon = Plus;
  protected readonly SettingsIcon = Settings;
  protected readonly SearchIcon = Search;

  toggleDropdown() {
    this.isOpen.update(v => !v);
    if (this.isOpen()) {
      this.searchQuery.set('');
    }
  }

  closeDropdown() {
    // Never while a switch is in flight: closing would hide the only place the failure is shown.
    if (this.switching()) return;
    this.isOpen.set(false);
  }

  /**
   * Switch the active tenant.
   *
   * This used to end at `// In a real app, this would call a service to switch organization.` —
   * it cleared the workspace and did nothing else, so choosing a different company closed every
   * open tab and left the user in exactly the tenant they started in. That is worse than not
   * offering the control: the interface reported a change that never happened.
   *
   * The switch has to reach the server because the tenant is a claim in the access token; a
   * client-side selection would leave the API enforcing the previous tenant. The workspace is
   * cleared only AFTER the server confirms, and the page then reloads so every resolver re-runs
   * against the new tenant rather than leaving the previous customer's data on screen.
   */
  selectOrganization(org: Organization) {
    const current = this.currentOrg();
    if (current?.id === org.id) {
      this.closeDropdown();
      return;
    }

    this.switching.set(true);
    this.switchError.set(null);

    this.organizationService.switchOrganization(org.id).subscribe({
      next: () => {
        // §10: the data belongs to another tenant now — close every tab and drop the persisted
        // workspace before reloading.
        this.tabPersistence.clearState();
        this.tabState.reset();
        this.reloadApplication();
      },
      error: () => {
        this.switching.set(false);
        this.switchError.set('No se pudo cambiar de empresa.');
      },
    });
  }

  /**
   * Reload the application after a tenant switch.
   *
   * A full reload rather than a router navigation: the tenant changes the answer to every resolver
   * and every cached signal in the app, and re-running them piecemeal is how one customer's data
   * ends up rendered beside another's. Isolated as a method so tests can observe it — `location`
   * is not redefinable in jsdom.
   */
  protected reloadApplication(): void {
    window.location.reload();
  }

  onSearch(event: Event) {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }
}
