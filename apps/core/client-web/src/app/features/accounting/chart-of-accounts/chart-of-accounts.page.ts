// app/features/accounting/chart-of-accounts/chart-of-accounts.page.ts
import { Component, inject, ChangeDetectionStrategy, OnInit, effect, linkedSignal } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ChartOfAccountsStateService } from '../../../core/state/chart-of-accounts.state';
import { LucideAngularModule, Plus, ChevronDown, ChevronRight, Edit, Trash, FileDown, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-angular';
import { Account, AccountType } from '../../../core/models/account.model';
import { FlattenedAccount } from '../../../core/models/flattened-account.model';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

@Component({
  selector: 'app-chart-of-accounts-page',
  standalone: true,
  imports: [FormsModule, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, ...VX_FORM_A11Y],
  templateUrl: './chart-of-accounts.page.html',
  styleUrls: ['./chart-of-accounts.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartOfAccountsPage implements OnInit {
  private readonly dialog = inject(DialogService);
  public readonly state = inject(ChartOfAccountsStateService);
  private readonly router = inject(Router);

  // Icons
  protected readonly PlusIcon = Plus;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly EditIcon = Edit;
  protected readonly TrashIcon = Trash;
  protected readonly ExportIcon = FileDown;
  protected readonly ArrowUpDownIcon = ArrowUpDown;
  protected readonly ArrowUpIcon = ArrowUp;
  protected readonly ArrowDownIcon = ArrowDown;

  // Enums para el template
  public readonly accountTypes = Object.values(AccountType);

  /**
   * La búsqueda, vista desde el armazón.
   *
   * `linkedSignal` y no una copia: el término vive en el estado del catálogo —de donde depende
   * `displayAccounts`— y el armazón necesita poder escribirlo. Escribir en él delega en el estado,
   * así que sigue habiendo una sola fuente.
   */
  readonly search = linkedSignal({
    source: this.state.searchTerm,
    computation: (term: string) => term,
  });

  /**
   * Devuelve al estado lo que el armazón escribe en `search`.
   *
   * Inicializador de campo y no `ngOnInit`: `effect()` exige contexto de inyección y ahí no lo
   * hay, así que lanzaba NG0203 en cada apertura de la página y el efecto nunca llegaba a
   * instalarse. La pantalla se veía bien —el error no interrumpe el render— pero el buscador
   * filtraba nada: el término se quedaba en el `linkedSignal` y el estado no se enteraba.
   */
  private readonly pushSearchToState = effect(() => this.state.setSearchTerm(this.search()));

  ngOnInit(): void {
    this.state.loadAccounts();
  }

  onFilterChange(filter: 'status' | 'type', value: any): void {
    this.state.setFilter(filter, value);
  }

  onSort(field: keyof FlattenedAccount): void {
    this.state.setSort(field);
  }
  
  getSortIcon(field: keyof FlattenedAccount) {
    const sort = this.state.sort();
    if (sort.field !== field) {
      return this.ArrowUpDownIcon;
    }
    return sort.direction === 'asc' ? this.ArrowUpIcon : this.ArrowDownIcon;
  }

  toggleExpand(account: FlattenedAccount): void {
      this.state.toggleAccountExpansion(account.id);
  }
  
  /**
   * Opens the account form, at the two URLs the manifest actually declares.
   *
   * This navigated to `/accounting/account-form`, which no manifest declares and no route table
   * contains. A URL that matches nothing opens the generic "under construction" window, so the
   * only way into the account form said the feature was not built yet — while the form itself sat
   * complete at `chart-of-accounts/new`, tabs for mappings, rules and dimensions included. Creating
   * an account from the interface was impossible for as long as that string was wrong.
   */
  goToAccountForm(id?: string): void {
    const route = id
      ? ['/accounting/chart-of-accounts', id, 'edit']
      : ['/accounting/chart-of-accounts/new'];
    this.router.navigate(route);
  }
  
  async deleteAccount(account: FlattenedAccount): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'dialog.delete_account.title',
      message: 'dialog.delete_account.message',
      messageParams: { name: account.name },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (confirmed) this.state.deleteAccount(account.id);
  }
}