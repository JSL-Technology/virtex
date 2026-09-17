import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * One identity document the tenant's country issues, as the catalogue returns it.
 *
 * `pattern` travels for immediate feedback; the check-digit algorithm does not. The arithmetic
 * verdict is the server's — publishing the algorithm would invite the client to reimplement it and
 * then disagree with the server about whether a document is valid.
 */
export interface IdentityDocumentTypeOption {
  code: string;
  /** The issuing jurisdiction, or `XX` for a supranational document such as a passport. */
  countryCode: string;
  labelKey: string;
  /**
   * The authority's own term, which must render untranslated.
   *
   * "CUIT" or "Ubigeo" glossed into the reader's language is harder to find on the paper they are
   * copying from, not easier. Present, it wins over `labelKey`.
   */
  labelVerbatim: string | null;
  example: string | null;
  pattern: string;
  requirement: 'required' | 'optional';
  appliesTo: 'individual' | 'company' | 'both';
  isDefault: boolean;
}

/**
 * The identity-document catalogue, for every form that captures who somebody is.
 *
 * ## Why one service and not one per form
 *
 * The employee form used to hold three `<option>` elements in its template; the customer and
 * supplier forms held a bare text input with no type at all. Three screens, three different
 * answers to "how is a person or a company identified here?", none of which agreed with the
 * server. This is the one place the client asks, and it asks the same endpoint the server
 * validates against.
 *
 * ## Cached per query
 *
 * The catalogue is reference data that changes when an operator inserts a row, so the cache is
 * per (appliesTo, usedFor) and lives for the page session — long enough that opening ten customer
 * forms costs one request, short enough that a reload picks up a new document type without a
 * deploy, which is the whole point of the catalogue being data.
 */
@Injectable({ providedIn: 'root' })
export class IdentityDocumentsService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, Observable<IdentityDocumentTypeOption[]>>();

  /**
   * The documents this tenant may offer, narrowed.
   *
   * The country is resolved server-side from the session, never passed from here: a client that
   * names its own country is a client that can be wrong about it, and being wrong about it is what
   * made every market validate under Dominican rules.
   */
  list(
    filters: {
      appliesTo?: 'individual' | 'company' | 'both';
      usedFor?: 'payroll' | 'invoicing' | 'registration';
    } = {},
  ): Observable<IdentityDocumentTypeOption[]> {
    const key = `${filters.appliesTo ?? ''}|${filters.usedFor ?? ''}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    let params = new HttpParams();
    if (filters.appliesTo) params = params.set('appliesTo', filters.appliesTo);
    if (filters.usedFor) params = params.set('usedFor', filters.usedFor);

    const request = this.http
      .get<IdentityDocumentTypeOption[]>(
        `${environment.apiUrl}/localization/identity-document-types`,
        { params },
      )
      // `refCount: false` so the response survives the last subscriber unsubscribing — a form that
      // is opened, closed and reopened should not re-fetch a catalogue that cannot have changed.
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));

    this.cache.set(key, request);
    return request;
  }

  /**
   * What to call a document on screen.
   *
   * Kept here rather than duplicated in each form, because "which of the two label fields wins"
   * is a property of the catalogue and not of any one screen.
   */
  label(type: IdentityDocumentTypeOption, translate: (key: string) => string): string {
    return type.labelVerbatim ?? translate(type.labelKey);
  }
}
