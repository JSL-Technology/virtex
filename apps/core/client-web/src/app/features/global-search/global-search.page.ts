import { Component, ChangeDetectionStrategy, inject, signal, OnInit, effect } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule, Search, FileText, Package, User } from 'lucide-angular';
import {
  SearchService,
  SearchResult,
  SearchResultGroup as BaseSearchResultGroup,
} from '../../core/services/search.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { IdentityDocumentsService } from '../../core/api/identity-documents.service';
import { catchError, of } from 'rxjs';
import { ListShellComponent } from '../../shared/components/gestures';

interface SearchResultGroup extends BaseSearchResultGroup {
  icon: any;
}

@Component({
  selector: 'app-global-search-page',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './global-search.page.html',
  styleUrls: ['./global-search.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalSearchPage implements OnInit {
  private route = inject(ActivatedRoute);
  private searchService = inject(SearchService);
  private readonly translate = inject(TranslateService);
  private readonly identityDocuments = inject(IdentityDocumentsService);

  /**
   * The identifier labels this tenant's country uses, so a customer hit can name its own document.
   *
   * The server used to send `RNC: <value>` assembled as a literal, which was Spanish for every
   * reader and Dominican for every market. It now sends the value and the document's catalogue
   * code, and the label is resolved here.
   */
  private documentLabels = new Map<string, string>();

  // Íconos
  protected readonly InvoiceIcon = FileText;
  protected readonly ProductIcon = Package;
  protected readonly CustomerIcon = User;
  protected readonly DefaultIcon = Search;
  private iconMap: Record<string, any> = {
    Invoices: this.InvoiceIcon,
    Products: this.ProductIcon,
    Customers: this.CustomerIcon,
  };

  // Estado
  searchQuery = signal('');
  totalResults = signal(0);
  resultGroups = signal<SearchResultGroup[]>([]);
  isLoading = signal(false);

  constructor() {
    //  El armazón escribe en `searchQuery` letra a letra. Buscar en cada pulsación sería una
    //  consulta por tecla contra siete tablas; esperar a Enter, como hacía antes, obliga a saber
    //  que hay que pulsarlo. Un retardo corto es lo que hace que buscar se sienta como buscar.
    let handle: ReturnType<typeof setTimeout> | undefined;
    effect((onCleanup) => {
      const query = this.searchQuery();
      handle = setTimeout(() => this.performSearch(query), 300);
      onCleanup(() => clearTimeout(handle));
    });
  }

  /**
   * A result's description, composed from its key and parameters.
   *
   * For a customer the `taxId` parameter is joined with the document's own name — "RNC",
   * "CNPJ", "Cédula de ciudadanía" — falling back to a neutral "tax id" label when the record
   * carries no type, which is every customer saved before the catalogue existed.
   */
  protected describe(item: SearchResult): string {
    const params = { ...(item.descriptionParams ?? {}) };
    if (item.documentTypeCode) {
      params['documentLabel'] =
        this.documentLabels.get(item.documentTypeCode) ?? item.documentTypeCode;
    } else {
      params['documentLabel'] = this.translate.instant('search.result.tax_id_label');
    }
    return this.translate.instant(item.descriptionKey, params);
  }

  /** A result's title: a key when it is prose, the plain string when it is data (a product name). */
  protected titleOf(item: SearchResult): string {
    if (item.title) return item.title;
    return item.titleKey ? this.translate.instant(item.titleKey, item.titleParams ?? {}) : '';
  }

  ngOnInit(): void {
    this.identityDocuments
      .list()
      .pipe(catchError(() => of([])))
      .subscribe((types) => {
        this.documentLabels = new Map<string, string>(
          types.map((type): [string, string] => [
            type.code,
            type.labelVerbatim ?? this.translate.instant(type.labelKey),
          ]),
        );
      });

    this.route.queryParamMap.subscribe((params) => {
      const query = params.get('q');
      if (query) this.searchQuery.set(query);
    });
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
          // Un tipo de grupo fuera del mapa dejaba `icon` en undefined y `lucide-icon`
          // lanzaba «No icon name or image has been provided». Con fallback nunca revienta.
          icon: this.iconMap[group.type] ?? this.DefaultIcon
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