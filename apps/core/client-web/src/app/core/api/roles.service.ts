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


@Injectable({ providedIn: 'root' })
export class RolesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/roles`;

  getRoles(): Observable<Role[]> {
    return this.http.get<Role[]>(this.apiUrl);
  }

  getAvailablePermissions(): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiUrl}/available-permissions`);
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