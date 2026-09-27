import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

/** An invitation waiting for the signed-in person's answer. */
export interface ReceivedInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  roleName: string;
  invitedByName: string | null;
  expiresAt: string;
  createdAt: string;
}

/**
 * Invitations to join another organization with the SAME account.
 *
 * An organization can no longer add an existing account to itself: it can only ask. The request
 * waits here until the person accepts or declines it from their own session; nothing about their
 * account changes before that.
 */
@Injectable({ providedIn: 'root' })
export class OrganizationInvitationsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/invitations`;

  private readonly _received = signal<ReceivedInvitation[]>([]);
  readonly received = this._received.asReadonly();

  refresh(): Observable<ReceivedInvitation[]> {
    return this.http
      .get<ReceivedInvitation[]>(`${this.apiUrl}/received`)
      .pipe(tap((list) => this._received.set(list ?? [])));
  }

  accept(id: string): Observable<{ messageKey: string; organizationId: string }> {
    return this.http
      .post<{ messageKey: string; organizationId: string }>(`${this.apiUrl}/${id}/accept`, {})
      .pipe(tap(() => this.drop(id)));
  }

  decline(id: string): Observable<{ messageKey: string }> {
    return this.http
      .post<{ messageKey: string }>(`${this.apiUrl}/${id}/decline`, {})
      .pipe(tap(() => this.drop(id)));
  }

  private drop(id: string): void {
    this._received.update((list) => list.filter((invitation) => invitation.id !== id));
  }
}
