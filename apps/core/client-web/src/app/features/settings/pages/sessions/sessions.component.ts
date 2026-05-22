
import { Component, OnInit, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { SessionService, UserSession } from '../../../../core/services/session.service';
import { finalize } from 'rxjs/operators';

@Component({
    selector: 'app-sessions',
    standalone: true,
    imports: [CommonModule, DatePipe],
    template: `
      <div class="p-6">
        <h2 class="text-2xl font-bold mb-4">Active Sessions</h2>
        <p class="text-gray-500 mb-6">Manage your active sessions and devices.</p>

        <div *ngIf="loading()" class="text-center py-4">Loading sessions...</div>

        <div *ngIf="!loading() && sessions().length === 0" class="text-center py-4 text-gray-500">
            No active sessions found.
        </div>

        <div class="grid gap-4">
            <div *ngFor="let session of sessions()" class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex justify-between items-center">
                <div>
                    <div class="font-semibold flex items-center gap-2">
                        {{ session.userAgent }}
                        <span *ngIf="session.isCurrent" class="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Current</span>
                    </div>
                    <div class="text-sm text-gray-500">
                        IP: {{ session.ipAddress }}
                    </div>
                    <div class="text-xs text-gray-400 mt-1">
                        Started: {{ session.createdAt | date:'medium' }}
                    </div>
                </div>
                <button
                    *ngIf="!session.isCurrent"
                    (click)="revoke(session.id)"
                    class="px-3 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 text-sm font-medium transition-colors"
                    [disabled]="processingId() === session.id">
                    {{ processingId() === session.id ? 'Revoking...' : 'Revoke' }}
                </button>
            </div>
        </div>
      </div>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SessionsComponent implements OnInit {
    private sessionService = inject(SessionService);

    sessions = signal<UserSession[]>([]);
    loading = signal(true);
    processingId = signal<string | null>(null);

    ngOnInit() {
        this.loadSessions();
    }

    loadSessions() {
        this.loading.set(true);
        this.sessionService.getSessions()
            .pipe(finalize(() => this.loading.set(false)))
            .subscribe({
                next: (data) => this.sessions.set(data),
                error: (err) => console.error('Failed to load sessions', err)
            });
    }

    revoke(sessionId: string) {
        if (!confirm('Are you sure you want to revoke this session?')) return;

        this.processingId.set(sessionId);
        this.sessionService.revokeSession(sessionId)
            .pipe(finalize(() => this.processingId.set(null)))
            .subscribe({
                next: () => {
                    this.sessions.update(current => current.filter(s => s.id !== sessionId));
                },
                error: (err) => alert('Failed to revoke session')
            });
    }
}
