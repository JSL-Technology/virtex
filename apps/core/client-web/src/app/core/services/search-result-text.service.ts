import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { FormatService } from '@virteex/shared/ui-i18n';
import { IdentityDocumentsService } from '../api/identity-documents.service';
import { SearchResult } from './search.service';

/**
 * How a search result reads, in one place for both places that show results.
 *
 * The search page composed titles and descriptions from the server's keys; the top bar's dropdown
 * printed `item.title` and `item.description` directly. An invoice carries a title KEY and no
 * `description` field at all, so in the dropdown — where most searches happen — an invoice found by
 * its NCF was an icon and nothing else (QA A-19).
 */
@Injectable({ providedIn: 'root' })
export class SearchResultTextService {
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly identityDocuments = inject(IdentityDocumentsService);

  /** Catalogue code → the identifier's own name ("RNC", "CNPJ", "EIN"…). Loaded once. */
  private documentLabels = new Map<string, string>();
  private labelsRequested = false;

  /** A result's title: a key when it is prose, the plain string when it is data (a product name). */
  title(item: SearchResult): string {
    if (item.title) return item.title;
    return item.titleKey ? this.translate.instant(item.titleKey, item.titleParams ?? {}) : '';
  }

  /**
   * A result's description, composed from its key and parameters.
   *
   * For a customer the `taxId` parameter is joined with the document's own name — falling back to a
   * neutral "tax id" label when the record carries no type.
   */
  describe(item: SearchResult): string {
    this.loadLabels();
    const params = { ...(item.descriptionParams ?? {}) };
    params['documentLabel'] = item.documentTypeCode
      ? (this.documentLabels.get(item.documentTypeCode) ?? item.documentTypeCode)
      : this.translate.instant('search.result.tax_id_label');
    return this.translate.instant(item.descriptionKey, params);
  }

  /** The total of a document result, in its own currency; empty for results that have none. */
  amount(item: SearchResult): string {
    return item.amount === undefined || item.amount === null ? '' : this.format.money(item.amount, item.currency ?? '');
  }

  /** The document's state in words ("Pagada", "Pendiente"…); empty when the result has none. */
  status(item: SearchResult): string {
    if (!item.status) return '';
    const key = `invoices.status.${item.status.toLowerCase().replace(/\s+/g, '_')}`;
    const text = this.translate.instant(key);
    return text === key ? item.status : text;
  }

  private loadLabels(): void {
    if (this.labelsRequested) return;
    this.labelsRequested = true;
    this.identityDocuments
      .list()
      .pipe(catchError(() => of([])))
      .subscribe((types) => {
        this.documentLabels = new Map<string, string>(
          types.map((type): [string, string] => [type.code, type.labelVerbatim ?? this.translate.instant(type.labelKey)]),
        );
      });
  }
}
