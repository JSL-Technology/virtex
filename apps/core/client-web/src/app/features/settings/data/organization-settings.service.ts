import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type SettingsSectionId = 'accounting' | 'currencies' | 'taxes' | 'closing' | 'intercompany' | 'inventory';

export interface SettingsAccountRef {
  id: string;
  code: string;
  name: string | Record<string, string>;
  type: string;
}

/** One section of the organization's settings as the API returns it (QA M-09). */
export interface SettingsSectionView {
  section: SettingsSectionId;
  accounts: Record<string, SettingsAccountRef | null>;
  expectedTypes: Record<string, string | null>;
  fields: Record<string, unknown>;
  baseCurrency?: { code: string; locked: boolean };
}

export interface SettingsSectionPatch {
  accounts?: Record<string, string | null>;
  fields?: Record<string, unknown>;
  baseCurrency?: string;
}

@Injectable({ providedIn: 'root' })
export class OrganizationSettingsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/organizations/settings`;

  get(section: SettingsSectionId): Observable<SettingsSectionView> {
    return this.http.get<SettingsSectionView>(`${this.apiUrl}/${section}`);
  }

  update(section: SettingsSectionId, patch: SettingsSectionPatch): Observable<SettingsSectionView> {
    return this.http.patch<SettingsSectionView>(`${this.apiUrl}/${section}`, patch);
  }
}
