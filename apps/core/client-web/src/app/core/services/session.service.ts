
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface UserSession {
    id: string;
    ipAddress: string;
    userAgent: string;
    createdAt: Date;
    expiresAt: Date;
    isCurrent: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class SessionService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/auth/sessions`;

    getSessions(): Observable<UserSession[]> {
        return this.http.get<UserSession[]>(this.apiUrl);
    }

    revokeSession(sessionId: string): Observable<void> {
        return this.http.post<void>(`${this.apiUrl}/${sessionId}/revoke`, {});
    }
}
