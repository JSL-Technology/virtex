import {
  Component, OnInit, ChangeDetectionStrategy,
  signal, inject, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Monitor, Smartphone, MapPin, X, RefreshCw, Clock } from 'lucide-angular';
import { SessionService, UserSession } from '../../../../core/services/session.service';
import { NotificationService } from '../../../../core/services/notification';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './sessions.component.html',
  styleUrls: ['./sessions.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsComponent implements OnInit {
  private sessionService = inject(SessionService);
  private notificationService = inject(NotificationService);
  private cdr = inject(ChangeDetectorRef);

  protected readonly MonitorIcon = Monitor;
  protected readonly SmartphoneIcon = Smartphone;
  protected readonly MapPinIcon = MapPin;
  protected readonly RevokeIcon = X;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly ClockIcon = Clock;

  sessions = signal<UserSession[]>([]);
  loading = signal(true);
  processingId = signal<string | null>(null);

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.sessionService.getSessions()
      .pipe(finalize(() => { this.loading.set(false); this.cdr.markForCheck(); }))
      .subscribe({
        next: (data) => this.sessions.set(data),
        error: () => this.notificationService.showError('No se pudieron cargar las sesiones.'),
      });
  }

  revoke(sessionId: string) {
    this.processingId.set(sessionId);
    this.sessionService.revokeSession(sessionId)
      .pipe(finalize(() => { this.processingId.set(null); this.cdr.markForCheck(); }))
      .subscribe({
        next: () => {
          this.sessions.update(s => s.filter(x => x.id !== sessionId));
          this.notificationService.showSuccess('Sesión revocada correctamente.');
        },
        error: () => this.notificationService.showError('No se pudo revocar la sesión.'),
      });
  }
}
