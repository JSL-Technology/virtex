import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Building, Check, ChevronsUpDown, Plus, Settings, Search } from 'lucide-angular';
import { ClickOutsideDirective } from '../../../../shared/directives/click-outside.directive';
import { AuthService } from '../../../../core/services/auth';
import { Organization } from '../../../../shared/interfaces/user.interface';

@Component({
  selector: 'app-company-switcher',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule, ClickOutsideDirective],
  templateUrl: './company-switcher.component.html',
  styleUrls: ['./company-switcher.component.scss']
})
export class CompanySwitcherComponent {
  private authService = inject(AuthService);

  isOpen = signal(false);
  searchQuery = signal('');

  // Mock organizations
  private mockOrganizations = signal<Organization[]>([
    { id: '1', name: 'Virtex Corp', logoUrl: '' },
    { id: '2', name: 'Acme Industries', logoUrl: '' },
    { id: '3', name: 'Globex Corporation', logoUrl: '' }
  ]);

  currentOrg = computed(() => this.authService.currentUser()?.organization);

  filteredOrganizations = computed(() => {
    const query = this.searchQuery().toLowerCase();
    const current = this.currentOrg();
    const all = this.mockOrganizations();

    // Ensure current org is in the list (if it's not already)
    const list = current && !all.find(o => o.id === current.id)
      ? [current, ...all]
      : all;

    if (!query) return list;
    return list.filter(org => org.name?.toLowerCase().includes(query));
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
    // In a real app, this would call a service to switch organization
    console.log('Switching to organization:', org.name);
    // For now, we just close the dropdown
    this.closeDropdown();
  }

  onSearch(event: Event) {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }
}
