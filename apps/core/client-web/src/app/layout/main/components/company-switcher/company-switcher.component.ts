import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Building, Check, ChevronsUpDown, Plus, Settings, Search } from 'lucide-angular';
import { ClickOutsideDirective } from '../../../../shared/directives/click-outside.directive';
import { AuthService } from '../../../../core/services/auth';
import { Organization } from '../../../../shared/interfaces/user.interface';
import { TabStateService } from '../../../../core/tabs/tab-state.service';
import { TabPersistenceService } from '../../../../core/tabs/tab-persistence.service';

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

  isOpen = signal(false);
  searchQuery = signal('');

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
    this.isOpen.set(false);
  }

  selectOrganization(org: Organization) {
    const current = this.currentOrg();
    this.closeDropdown();

    // §10: al cambiar de empresa/tenant los datos pertenecen a otro contexto.
    // Se cierran TODAS las pestañas, se limpia el workspace persistido y se
    // abre el Dashboard del nuevo tenant.
    if (current?.id === org.id) return;

    // In a real app, this would call a service to switch organization.
    this.tabPersistence.clearState();
    this.tabState.reset();
  }

  onSearch(event: Event) {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }
}
