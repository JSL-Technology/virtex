import {
  Component, OnInit, ChangeDetectionStrategy,
  signal, computed, inject, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { LucideAngularModule, Monitor, Smartphone, MapPin, X, RefreshCw, Clock, LocateFixed } from 'lucide-angular';
import { SessionService, UserSession } from '../../../../core/services/session.service';
import { NotificationService } from '../../../../core/services/notification';
import { finalize } from 'rxjs/operators';
import { TranslatePipe } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VxSpinnerComponent } from '../../../../shared/components/feedback';
import { VxBadgeComponent } from '../../../../shared/components/badge';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslatePipe, ...FORMAT_PIPES, VxSpinnerComponent, VxBadgeComponent],
  templateUrl: './sessions.component.html',
  styleUrls: ['./sessions.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsComponent implements OnInit {
  /** The server records an agent it cannot read as `'Unknown'`; that word is not for the screen. */
  protected known(value: string | null | undefined): string | null {
    return value && value !== 'Unknown' ? value : null;
  }

  private sessionService = inject(SessionService);
  private notificationService = inject(NotificationService);
  private cdr = inject(ChangeDetectorRef);
  private sanitizer = inject(DomSanitizer);

  protected readonly MonitorIcon = Monitor;
  protected readonly SmartphoneIcon = Smartphone;
  protected readonly MapPinIcon = MapPin;
  protected readonly RevokeIcon = X;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly ClockIcon = Clock;
  protected readonly LocateIcon = LocateFixed;

  /** The map renders only when a Maps Embed API key is configured for this build. */
  protected readonly mapsEnabled = !!environment.googleMapsApiKey;

  sessions = signal<UserSession[]>([]);
  loading = signal(true);
  processingId = signal<string | null>(null);

  /**
   * A precise GPS fix for THIS device, obtained on request through the browser's Geolocation API.
   *
   * The server can only place a session by its IP, which is city-level at best and nothing at all
   * for a localhost or private address — so "ubicación precisa" cannot come from the backend. The
   * browser can, with the user's consent, and only for the device they are sitting at; a remote
   * session's precise position is neither knowable nor theirs to reveal.
   */
  preciseCoords = signal<{ lat: number; lng: number } | null>(null);
  locating = signal(false);
  locateError = signal<string | null>(null);

  /**
   * One Google Maps embed URL per session that has a position, rebuilt only when the sessions or
   * the precise fix change — not on every change-detection pass, which would reload every iframe.
   * The current device prefers its precise GPS fix; the rest use their IP-derived coordinates.
   */
  readonly mapUrls = computed<Map<string, SafeResourceUrl>>(() => {
    const urls = new Map<string, SafeResourceUrl>();
    if (!this.mapsEnabled) return urls;
    const precise = this.preciseCoords();
    for (const session of this.sessions()) {
      const coords =
        session.isCurrent && precise
          ? precise
          : session.latitude != null && session.longitude != null
            ? { lat: session.latitude, lng: session.longitude }
            : null;
      if (!coords) continue;
      const q = encodeURIComponent(`${coords.lat},${coords.lng}`);
      const key = encodeURIComponent(environment.googleMapsApiKey);
      const url = `https://www.google.com/maps/embed/v1/place?key=${key}&q=${q}&zoom=15`;
      urls.set(session.id, this.sanitizer.bypassSecurityTrustResourceUrl(url));
    }
    return urls;
  });

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.sessionService.getSessions()
      .pipe(finalize(() => { this.loading.set(false); this.cdr.markForCheck(); }))
      .subscribe({
        next: (data) => this.sessions.set(data),
        error: () => this.notificationService.showError('settings.sessions.sessions_could_not_loaded'),
      });
  }

  revoke(sessionId: string) {
    this.processingId.set(sessionId);
    this.sessionService.revokeSession(sessionId)
      .pipe(finalize(() => { this.processingId.set(null); this.cdr.markForCheck(); }))
      .subscribe({
        next: () => {
          this.sessions.update(s => s.filter(x => x.id !== sessionId));
          this.notificationService.showSuccess('settings.sessions.session_revoked_successfully');
        },
        error: () => this.notificationService.showError('settings.sessions.session_could_not_revoked'),
      });
  }

  /**
   * Ask the browser for a precise GPS fix for this device and re-centre its map on it.
   *
   * `enableHighAccuracy` requests the GPS/Wi-Fi fix rather than the coarse IP one; the error
   * branch covers both a denied permission and a timeout, so the button never hangs silently.
   */
  locatePrecisely(): void {
    if (!navigator.geolocation) {
      this.locateError.set('settings.sessions.geolocation_unsupported');
      return;
    }
    this.locating.set(true);
    this.locateError.set(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.preciseCoords.set({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        this.locating.set(false);
        this.cdr.markForCheck();
      },
      () => {
        this.locateError.set('settings.sessions.geolocation_denied');
        this.locating.set(false);
        this.cdr.markForCheck();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }
}
