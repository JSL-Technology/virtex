import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { User } from '../../../shared/interfaces/user.interface';

export interface InviteUserDto {
  firstName: string;
  lastName: string;
  email: string;
  roleId: string;
}

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  email?: string;
  roleId?: string;
  preferredLanguage?: string;
}

export interface UpdateProfileDto {
  firstName?: string;
  lastName?: string;
  preferredLanguage?: string;
  phone?: string;
  jobTitle?: string;
  email?: string;
}

// Interfaz para la respuesta paginada
export interface PaginatedUsersResponse {
  data: User[];
  total: number;
}

/**
 * An invitation this organization sent to somebody who already has an account elsewhere. It grants
 * nothing until that person accepts it from their own session.
 */
export interface SentInvitation {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  roleName: string;
  expiresAt: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class UsersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/users`;

  getJobTitles(): Observable<string[]> {
      return this.http.get<string[]>(`${this.apiUrl}/job-titles`);
  }

  getProfile(): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}/profile`);
  }

  updateProfile(data: UpdateProfileDto): Observable<User> {
    return this.http.patch<User>(`${this.apiUrl}/profile`, data);
  }

  requestEmailChange(data: { newEmail: string; currentPassword: string }): Observable<{ message: string }> {
      return this.http.post<{ message: string }>(`${this.apiUrl}/profile/email-change/request`, data);
  }

  /**
   * Complete an email change with the token from the confirmation link.
   *
   * The backend has had this endpoint since the two-step flow was introduced, but nothing ever
   * called it: the confirmation email pointed at `/settings/email-change/confirm`, a route that
   * does not exist. The change could be requested and never applied.
   */
  confirmEmailChange(token: string): Observable<{ message: string }> {
      return this.http.post<{ message: string }>(`${this.apiUrl}/profile/email-change/confirm`, { token });
  }

  uploadAvatar(file: File): Observable<{ avatarUrl: string }> {
      const formData = new FormData();
      formData.append('file', file);
      return this.http.post<{ avatarUrl: string }>(`${this.apiUrl}/profile/avatar`, formData);
  }

  getUsers(options: {
    page: number;
    pageSize: number;
    searchTerm?: string;
    statusFilter?: string;
    sortColumn?: string;
    sortDirection?: 'ASC' | 'DESC';
  }): Observable<PaginatedUsersResponse> {
    let params = new HttpParams()
      .set('page', options.page.toString())
      .set('pageSize', options.pageSize.toString());

    // The names `ListUsersQueryDto` declares. This sent `searchTerm` and `statusFilter`, which the
    // server rejects (`forbidNonWhitelisted`), so searching or filtering the member list failed.
    if (options.searchTerm) {
      params = params.set('search', options.searchTerm);
    }
    if (options.statusFilter && options.statusFilter !== 'all') {
      params = params.set('status', options.statusFilter);
    }
    if (options.sortColumn) {
      params = params.set('sortColumn', options.sortColumn);
    }
    if (options.sortDirection) {
      params = params.set('sortDirection', options.sortDirection);
    }

    return this.http.get<PaginatedUsersResponse>(this.apiUrl, { params });
  }

  updateUser(id: string, payload: UpdateUserDto): Observable<User> {
    return this.http.patch<User>(`${this.apiUrl}/${id}`, payload);
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  /** Invitations this organization sent to existing accounts that are still unanswered. */
  getSentInvitations(): Observable<SentInvitation[]> {
    return this.http.get<SentInvitation[]>(`${environment.apiUrl}/invitations/sent`);
  }

  /** Withdraw an unanswered invitation this organization sent. */
  revokeInvitation(id: string): Observable<{ messageKey: string }> {
    return this.http.delete<{ messageKey: string }>(`${environment.apiUrl}/invitations/${id}`);
  }

  inviteUser(userData: InviteUserDto): Observable<User> {
    return this.http.post<User>(`${this.apiUrl}/invite`, userData);
  }

  /** A new invitation link for a member who has not activated their account yet. */
  resendInvitation(userId: string): Observable<{ email: string; expiresAt: string }> {
    return this.http.post<{ email: string; expiresAt: string }>(`${this.apiUrl}/${userId}/resend-invitation`, {});
  }

  setUserStatus(userId: string, status: string): Observable<User> {
      return this.http.patch<User>(`${this.apiUrl}/${userId}/status`, {
        status,
      });
  }

  // Si necesitamos bloquear usuario, usamos una ruta distinta o el update normal
  blockUser(userId: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/${userId}/block-and-logout`,
      {},
    );
  }

  sendPasswordReset(userId: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiUrl}/${userId}/reset-password`,
      {},
    );
  }

  forceLogout(userId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${userId}/force-logout`, {});
  }

  blockAndLogout(userId: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/${userId}/block-and-logout`,
      {},
    );
  }
}
