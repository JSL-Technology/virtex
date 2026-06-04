import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Session {
  id: string;
  ipAddress: string;
  userAgent: string;
  browser: string;
  os: string;
  deviceType: string;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
  country?: string;
  city?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
}

export interface TwoFactorSetupResponse {
  secret: string;
  otpauthUrl: string;
}

export interface BackupCodesResponse {
  codes: string[];
}

@Injectable({
  providedIn: 'root'
})
export class SecurityService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/auth`;

  getActiveSessions(): Observable<Session[]> {
    return this.http.get<Session[]>(`${this.apiUrl}/sessions`);
  }

  // H15 FIX: Backend uses POST /sessions/:id/revoke, not DELETE /sessions/:id.
  revokeSession(sessionId: string, stepUpToken?: string): Observable<void> {
    const headers = stepUpToken ? { 'x-step-up-token': stepUpToken } : {};
    return this.http.post<void>(`${this.apiUrl}/sessions/${sessionId}/revoke`, {}, { headers });
  }

  generate2faSecret(): Observable<TwoFactorSetupResponse> {
    return this.http.post<TwoFactorSetupResponse>(`${this.apiUrl}/2fa/generate`, {});
  }

  // H-05 FIX: Backend requires `currentPassword` for step-up before enabling 2FA
  // (OWASP ASVS 2.2.2 reauthentication for sensitive operations; CWE-306).
  enable2fa(token: string, currentPassword: string, stepUpToken?: string): Observable<{ backupCodes: string[] }> {
    const headers = stepUpToken ? { 'x-step-up-token': stepUpToken } : {};
    return this.http.post<{ backupCodes: string[] }>(`${this.apiUrl}/2fa/enable`, { token, currentPassword }, { headers });
  }

  disable2fa(stepUpToken?: string): Observable<void> {
    const headers = stepUpToken ? { 'x-step-up-token': stepUpToken } : {};
    return this.http.post<void>(`${this.apiUrl}/2fa/disable`, {}, { headers });
  }

  generateBackupCodes(stepUpToken?: string): Observable<BackupCodesResponse> {
    const headers = stepUpToken ? { 'x-step-up-token': stepUpToken } : {};
    return this.http.post<BackupCodesResponse>(`${this.apiUrl}/2fa/backup-codes/generate`, {}, { headers });
  }

  sendEmailVerification(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/2fa/send-email-verification`, {});
  }

  verifyEmailVerification(code: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/2fa/verify-email-verification`, { code });
  }
}
