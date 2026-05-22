// app/features/accounting/chart-of-accounts/chart-of-accounts.page.ts
import { Component, inject, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ChartOfAccountsStateService } from '../../../core/state/chart-of-accounts.state';
import { LucideAngularModule, Plus, ChevronDown, ChevronRight, Edit, Trash, FileDown, Search, RefreshCcw, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-angular';
import { Account, AccountType } from '../../../core/models/account.model';
import { FlattenedAccount } from '../../../core/models/flattened-account.model';

@Component({
  selector: 'app-chart-of-accounts-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule, TitleCasePipe],
  templateUrl: './chart-of-accounts.page.html',
  styleUrls: ['./chart-of-accounts.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartOfAccountsPage implements OnInit {
  public readonly state = inject(ChartOfAccountsStateService);
  private readonly router = inject(Router);

  // Icons
  protected readonly PlusIcon = Plus;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly EditIcon = Edit;
  protected readonly TrashIcon = Trash;
  protected readonly ExportIcon = FileDown;
  protected readonly refreshCcw = RefreshCcw;
  protected readonly search = Search;
  protected readonly ArrowUpDownIcon = ArrowUpDown;
  protected readonly ArrowUpIcon = ArrowUp;
  protected readonly ArrowDownIcon = ArrowDown;

  // Enums para el template
  public readonly accountTypes = Object.values(AccountType);

  ngOnInit(): void {
    this.state.loadAccounts();
  }

  onSearchTermChange(term: string): void {
    this.state.setSearchTerm(term);
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
  
  deleteAccount(account: FlattenedAccount): void {
      if (confirm(`Are you sure you want to delete account "${account.name}"? This action cannot be undone.`)) {
          this.state.deleteAccount(account.id);
      }
  }
}