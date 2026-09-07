// app/features/accounting/chart-of-accounts/chart-of-accounts.page.ts
import { Component, inject, ChangeDetectionStrategy, OnInit, effect, linkedSignal } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ChartOfAccountsStateService } from '../../../core/state/chart-of-accounts.state';
import { LucideAngularModule, Plus, ChevronDown, ChevronRight, Edit, Trash, FileDown, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-angular';
import { Account, AccountType } from '../../../core/models/account.model';
import { FlattenedAccount } from '../../../core/models/flattened-account.model';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { ListShellComponent } from '../../../shared/components/gestures';

@Component({
  selector: 'app-chart-of-accounts-page',
  standalone: true,
  imports: [FormsModule, RouterLink, LucideAngularModule, TitleCasePipe, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
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

  ngOnInit(): void {
    this.state.loadAccounts();

    effect(() => this.state.setSearchTerm(this.search()));
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
  
  goToAccountForm(id?: string): void {
    const route = id ? ['/accounting/account-form', id] : ['/accounting/account-form'];
    this.router.navigate(route);
  }
  
  async deleteAccount(account: FlattenedAccount): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'DIALOG.DELETE_ACCOUNT.TITLE',
      message: 'DIALOG.DELETE_ACCOUNT.MESSAGE',
      messageParams: { name: account.name },
      confirmText: 'COMMON.DELETE',
      variant: 'danger',
    });
    if (confirmed) this.state.deleteAccount(account.id);
  }
}