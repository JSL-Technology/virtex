import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule, Search, FileText, Package, User } from 'lucide-angular';
import { SearchService, SearchResultGroup as BaseSearchResultGroup } from '../../core/services/search.service';

interface SearchResultGroup extends BaseSearchResultGroup {
  icon: any;
}

@Component({
  selector: 'app-global-search-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './global-search.page.html',
  styleUrls: ['./global-search.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalSearchPage implements OnInit {
  private route = inject(ActivatedRoute);
  private searchService = inject(SearchService);

  // Íconos
  protected readonly SearchIcon = Search;
  protected readonly InvoiceIcon = FileText;
  protected readonly ProductIcon = Package;
  protected readonly CustomerIcon = User;
  private iconMap = {
    Invoices: this.InvoiceIcon,
    Products: this.ProductIcon,
    Customers: this.CustomerIcon,
  };

  // Estado
  searchQuery = signal('');
  totalResults = signal(0);
  resultGroups = signal<SearchResultGroup[]>([]);
  isLoading = signal(false);

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      const query = params.get('q');
      if (query) {
        this.searchQuery.set(query);
        this.performSearch(query);
      }
    });
  }

  handleSearchInput(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    if (inputElement) {
      this.searchQuery.set(inputElement.value);
    }
  }

  performSearch(query: string): void {
    if (!query || query.trim().length === 0) {
      this.resultGroups.set([]);
      this.totalResults.set(0);
      return;
    }
    
    this.isLoading.set(true);
    this.searchService.search(query).subscribe({
      next: (groups) => {
        const enhancedGroups = groups.map(group => ({
          ...group,
          icon: this.iconMap[group.type]
        }));
        this.resultGroups.set(enhancedGroups);
        const total = groups.reduce((sum, group) => sum + group.results.length, 0);
        this.totalResults.set(total);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.resultGroups.set([]);
        this.totalResults.set(0);
        // Aquí podrías manejar el error, por ejemplo, mostrando un mensaje al usuario.
      }
    });
  }
}