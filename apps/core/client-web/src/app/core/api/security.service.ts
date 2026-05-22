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

  revokeSession(sessionId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/sessions/${sessionId}`);
  }

  generate2faSecret(): Observable<TwoFactorSetupResponse> {
    return this.http.post<TwoFactorSetupResponse>(`${this.apiUrl}/2fa/generate`, {});
  }

  enable2fa(token: string): Observable<{ backupCodes: string[] }> {
    return this.http.post<{ backupCodes: string[] }>(`${this.apiUrl}/2fa/enable`, { token });
  }

  disable2fa(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/2fa/disable`, {});
  }

  generateBackupCodes(): Observable<BackupCodesResponse> {
    return this.http.post<BackupCodesResponse>(`${this.apiUrl}/2fa/backup-codes/generate`, {});
  }

  sendEmailVerification(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/2fa/send-email-verification`, {});
  }

  verifyEmailVerification(code: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/2fa/verify-email-verification`, { code });
  }
}
