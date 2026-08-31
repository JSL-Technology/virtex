import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { RoleContract } from '@virteex/shared/types';
// import { environment } from '../../../environments/environment';

// The Role shape is defined once in @virteex/shared/types and implemented by the backend's
// RoleResponseDto, so the two cannot drift. Re-exported here to keep existing imports working.
export type Role = RoleContract;

export interface CreateRoleDto {
  name: string;
  description?: string;
  permissions: string[];
}

export type UpdateRoleDto = Partial<CreateRoleDto>;

/** One permission, as the catalogue describes it. `value` is stored; `actionKey` is displayed. */
export interface PermissionEntryContract {
  value: string;
  actionKey: string;
}

export interface PermissionGroupContract {
  key: string;
  labelKey: string;
  permissions: PermissionEntryContract[];
}


@Injectable({ providedIn: 'root' })
export class RolesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/roles`;

  getRoles(): Observable<Role[]> {
    return this.http.get<Role[]>(this.apiUrl);
  }

  /**
   * The permission catalogue, grouped and named by the server.
   *
   * This returned a flat list of slugs and the roles page built its own labels by splitting on
   * the colon — so the screen that governs access to the ledger showed a group called
   * "Journal_entries" and a checkbox called "view". The server now names both, as keys.
   */
  getAvailablePermissions(): Observable<PermissionGroupContract[]> {
    return this.http.get<PermissionGroupContract[]>(`${this.apiUrl}/available-permissions`);
  }

  createRole(role: CreateRoleDto): Observable<Role> {
    return this.http.post<Role>(this.apiUrl, role);
  }

  updateRole(id: string, role: UpdateRoleDto): Observable<Role> {
    return this.http.patch<Role>(`${this.apiUrl}/${id}`, role);
  }
  
  cloneRole(id: string): Observable<Role> {
    return this.http.post<Role>(`${this.apiUrl}/clone/${id}`, {});
  }

  deleteRole(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}