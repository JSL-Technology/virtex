import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Building, Check, ChevronsUpDown, Plus, Settings, Search } from 'lucide-angular';
import { ClickOutsideDirective } from '../../../../shared/directives/click-outside.directive';
import { AuthService } from '../../../../core/services/auth';
import { Organization } from '../../../../shared/interfaces/user.interface';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-company-switcher',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule, ClickOutsideDirective],
  templateUrl: './company-switcher.component.html',
  styleUrls: ['./company-switcher.component.scss']
})
export class CompanySwitcherComponent {
  private authService = inject(AuthService);
  private tenancy = inject(ActiveOrganizationService);
  private router = inject(Router);

  isOpen = signal(false);
  searchQuery = signal('');
  switching = signal(false);
  switchError = signal<string | null>(null);

  //  De la URL, no del token: es la empresa de ESTA ventana. Con dos ventanas en dos empresas,
  //  el token dice una sola cosa y cada ventana tiene que mostrar la suya.
  currentOrg = computed(() => this.tenancy.organization());

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
   * Cambia de empresa navegando.
   *
   * Tuvo dos vidas anteriores, y las dos costaban algo. La primera terminaba en
   * `// In a real app, this would call a service to switch organization.`: la interfaz decía que
   * habías cambiado de empresa y no habías cambiado. La segunda llamaba a
   * `POST /organizations/switch` para emitir tokens nuevos y recargaba la página entera, lo que
   * cerraba todas las pestañas y tiraba el espacio de trabajo — cambiar de empresa costaba la
   * sesión de trabajo completa.
   *
   * Con la empresa en la ruta, cambiarla es ir a la misma página en la otra empresa. No hay
   * recarga, no hay tokens nuevos y no se pierde nada: el espacio de trabajo de cada empresa se
   * guarda con su propia clave y sigue ahí al volver. Y los datos de una no quedan en pantalla
   * junto a los de otra, porque la ventana navega y cada pantalla vuelve a pedir los suyos con la
   * cabecera de la empresa nueva.
   *
   * El token sigue llevando una empresa, y sigue siendo la que se usa cuando una petición no
   * nombra ninguna. No se reemite aquí a propósito: el token lo comparten todas las pestañas, así
   * que reemitirlo por un cambio local volvería a convertir una decisión de ESTA ventana en una
   * decisión de todas, que es exactamente lo que este diseño elimina. Dónde aterriza la próxima
   * sesión lo recuerda `ActiveOrganizationService`, por navegador.
   */
  selectOrganization(org: Organization) {
    const current = this.currentOrg();
    if (current?.id === org.id) {
      this.closeDropdown();
      return;
    }

    this.switching.set(true);
    this.switchError.set(null);

    // Navegar, no recargar. Antes esto llamaba a `POST /organizations/switch` para emitir tokens
    // nuevos y recargaba la página entera, lo que cerraba todas las pestañas y tiraba el espacio
    // de trabajo: cambiar de empresa costaba la sesión de trabajo completa. Con la empresa en la
    // ruta, cambiarla es ir a la misma página en la otra empresa; el espacio de trabajo de cada
    // una se guarda con su propia clave y sigue ahí al volver.
    //
    // Tampoco hace falta cerrar pestañas: las de la otra empresa no se pierden, se quedan donde
    // estaban. Y no hay datos de un inquilino en pantalla junto a los de otro, porque la ventana
    // navega a la nueva empresa y cada pantalla vuelve a pedir sus datos con la cabecera nueva.
    void this.router
      .navigateByUrl(this.tenancy.urlInOrganization(org.slug))
      .then((ok) => {
        this.switching.set(false);
        if (ok) {
          this.tenancy.remember(org.slug);
          this.closeDropdown();
        } else {
          // Un guard rechazó la navegación: la razón la da él, no este menú.
          this.switchError.set('No se pudo cambiar de empresa.');
        }
      })
      .catch(() => {
        this.switching.set(false);
        this.switchError.set('No se pudo cambiar de empresa.');
      });
  }

  onSearch(event: Event) {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }
}
