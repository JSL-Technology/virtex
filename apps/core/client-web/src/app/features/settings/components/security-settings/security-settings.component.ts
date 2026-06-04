
import { Component, OnInit, ChangeDetectionStrategy, inject, signal, DestroyRef, ViewChildren, ViewChild, QueryList, ElementRef, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { LucideAngularModule, Shield, Smartphone, QrCode, Monitor, Laptop, Globe, AlertTriangle, CheckCircle, MapPin, Copy, Download, RefreshCw, X, ArrowRight, ImageIcon, User, Mail, Phone, Building } from 'lucide-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../../core/services/auth';
import { StepUpService } from '../../../../core/services/step-up.service';
import { SecurityService, Session } from '../../../../core/api/security.service';
import { NotificationService } from '../../../../core/services/notification';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QRCodeComponent } from 'angularx-qrcode';
import { FormsModule } from '@angular/forms';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { OtpComponent } from '../../../../shared/components/otp/otp.component';

type SetupStep = 'INTRO' | 'EMAIL_VERIFY' | 'QR_SETUP' | 'BACKUP_CODES';

@Component({
  selector: 'app-security-settings',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, QRCodeComponent, FormsModule, ConfirmationModalComponent, OtpComponent],
  templateUrl: './security-settings.component.html',
  styleUrls: ['./security-settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecuritySettingsComponent implements OnInit {
  private authService = inject(AuthService);
  private stepUpService = inject(StepUpService);
  private securityService = inject(SecurityService);
  private notificationService = inject(NotificationService);
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);
  private translate = inject(TranslateService);

  @ViewChild(OtpComponent) otpComponent?: OtpComponent;

  // Icons
  protected readonly ShieldIcon = Shield;
  protected readonly SmartphoneIcon = Smartphone;
  protected readonly QrCodeIcon = QrCode;
  protected readonly MonitorIcon = Monitor;
  protected readonly LaptopIcon = Laptop;
  protected readonly GlobeIcon = Globe;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly MapPinIcon = MapPin;
  protected readonly CopyIcon = Copy;
  protected readonly DownloadIcon = Download;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly XIcon = X;
  protected readonly ArrowRightIcon = ArrowRight;
  protected readonly ImageIcon = ImageIcon;
  protected readonly UserIcon = User;
  protected readonly MailIcon = Mail;
  protected readonly PhoneIcon = Phone;
  protected readonly CompanyIcon = Building;

  currentUser = this.authService.currentUser;

  // 2FA State
  is2faEnabled = signal(false);
  showSetupModal = signal(false);
  currentStep = signal<SetupStep>('EMAIL_VERIFY');

  // Step 1: Email Verify
  emailCode = signal('');
  isResendingEmail = signal(false);

  // Step 2: QR Setup
  qrCodeData = signal<string>('');
  twoFactorSecret = signal<string>('');
  verificationCode = signal('');
  // H-05 FIX: Collect the user's current password for the step-up check that
  // the backend requires before enabling 2FA (OWASP ASVS 2.2.2; CWE-306).
  stepUpPassword = signal('');

  // Step 3: Backup Codes
  backupCodes = signal<string[]>([]);
  hasSavedBackupCodes = signal(false);

  // Sessions
  sessions = signal<Session[]>([]);
  expandedSessionId = signal<string | null>(null);
  private map: any;

  @ViewChildren('mapContainer') mapContainers!: QueryList<ElementRef<HTMLDivElement>>;

  // Confirmation Modal
  showDisableConfirmation = signal(false);

  ngOnInit() {
    this.is2faEnabled.set(!!this.currentUser()?.isTwoFactorEnabled);
    this.loadSessions();
  }

  loadSessions() {
    this.securityService.getActiveSessions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(sessions => this.sessions.set(sessions));
  }

  // --- 2FA Setup Flow ---

  start2faSetup() {
    this.currentStep.set('INTRO');
    this.emailCode.set('');
    this.showSetupModal.set(true);
  }

  proceedToEmailVerification() {
    this.currentStep.set('EMAIL_VERIFY');
    this.sendEmailVerification();
  }

  closeSetupModal() {
    this.showSetupModal.set(false);
    this.emailCode.set('');
    this.verificationCode.set('');
    this.stepUpPassword.set('');
    this.backupCodes.set([]);
    this.hasSavedBackupCodes.set(false);
  }

  // Step 1 Logic
  sendEmailVerification() {
    this.isResendingEmail.set(true);
    this.securityService.sendEmailVerification()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.notificationService.showSuccess('SETTINGS.SECURITY.EMAIL_CODE_SENT');
          this.isResendingEmail.set(false);
        },
        error: () => {
          this.notificationService.showError('SETTINGS.SECURITY.ERRORS.SEND_FAILED');
          this.isResendingEmail.set(false);
        }
      });
  }

  verifyEmailCode(code?: string) {
    const finalCode = code || this.emailCode();
    if (!finalCode || finalCode.length < 6) return;

    this.securityService.verifyEmailVerification(finalCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (this.otpComponent) this.otpComponent.handleSuccess(this.translate.instant('COMMON.SUCCESS'));
          setTimeout(() => this.generateQrCode(), 1000);
        },
        error: () => {
          this.notificationService.showError('SETTINGS.SECURITY.ERRORS.INVALID_CODE');
          if (this.otpComponent) {
            this.otpComponent.handleError(this.translate.instant('SETTINGS.SECURITY.ERRORS.INVALID_CODE'));
          }
        }
      });
  }

  // Step 2 Logic
  private generateQrCode() {
    this.securityService.generate2faSecret()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.twoFactorSecret.set(res.secret);
          this.qrCodeData.set(res.otpauthUrl);
          this.currentStep.set('QR_SETUP');
        },
        error: () => {
            this.notificationService.showError('SETTINGS.SECURITY.ERRORS.SETUP_FAILED');
            this.closeSetupModal();
        }
      });
  }

  async verifyAndEnable2fa(code?: string) {
    const finalCode = code || this.verificationCode();
    const password = this.stepUpPassword();
    if (!finalCode || finalCode.length < 6) return;
    if (!password) {
      this.notificationService.showError('SETTINGS.SECURITY.ERRORS.PASSWORD_REQUIRED');
      return;
    }

    try {
        await this.stepUpService.requireStepUp('enable_2fa');
    } catch (e) {
        return;
    }

    // H-05 FIX: Send currentPassword for step-up; backend verifies it with Argon2
    // before enabling 2FA (OWASP ASVS 2.2.2; CWE-306).
    this.securityService.enable2fa(finalCode, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (this.otpComponent) this.otpComponent.handleSuccess(this.translate.instant('SETTINGS.SECURITY.2FA_ENABLED'));
          setTimeout(() => {
              this.is2faEnabled.set(true);
              this.backupCodes.set(res.backupCodes);
              this.currentStep.set('BACKUP_CODES');
              this.notificationService.showSuccess('SETTINGS.SECURITY.2FA_ENABLED');
          }, 1000);
        },
        error: () => {
          this.notificationService.showError('SETTINGS.SECURITY.ERRORS.INVALID_CODE');
          if (this.otpComponent) {
            this.otpComponent.handleError(this.translate.instant('SETTINGS.SECURITY.ERRORS.INVALID_CODE'));
          }
        }
      });
  }

  copySecret() {
      navigator.clipboard.writeText(this.twoFactorSecret()).then(() => {
          this.notificationService.showSuccess('SETTINGS.SECURITY.COPIED');
      });
  }

  // Step 3 Logic
  copyBackupCodes() {
      const text = this.backupCodes().join('\n');
      navigator.clipboard.writeText(text).then(() => {
          this.notificationService.showSuccess('SETTINGS.SECURITY.COPIED');
      });
  }

  async downloadBackupCodes() {
      try {
          await this.stepUpService.requireStepUp('generate_backup_codes');
      } catch (e) {
          return;
      }

      const text = this.backupCodes().join('\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'backup-codes.txt';
      a.click();
      window.URL.revokeObjectURL(url);
  }

  completeSetup() {
      if (!this.hasSavedBackupCodes()) {
          this.notificationService.showError('SETTINGS.SECURITY.CONFIRM_BACKUP_CODES');
          return;
      }
      this.closeSetupModal();
      this.authService.checkAuthStatus().subscribe();
  }

  // --- End 2FA Setup Flow ---

  confirmDisable2fa() {
    this.showDisableConfirmation.set(true);
  }

  async onDisableConfirmed() {
    this.showDisableConfirmation.set(false);

    try {
        await this.stepUpService.requireStepUp('disable_2fa');
    } catch (e) {
        return;
    }

    this.securityService.disable2fa()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.is2faEnabled.set(false);
          this.notificationService.showSuccess('SETTINGS.SECURITY.2FA_DISABLED');
          this.authService.checkAuthStatus().subscribe();
        },
        error: () => this.notificationService.showError('SETTINGS.SECURITY.ERRORS.DISABLE_FAILED')
      });
  }

  revokeSession(sessionId: string, event: Event) {
    event.stopPropagation();
    this.securityService.revokeSession(sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadSessions();
          this.notificationService.showSuccess('SETTINGS.SECURITY.SESSION_REVOKED');
        },
        error: () => this.notificationService.showError('SETTINGS.SECURITY.ERRORS.REVOKE_FAILED')
      });
  }

  disable2fa() {
    this.confirmDisable2fa();
  }

  toggleSessionDetails(session: Session) {
    if (this.expandedSessionId() === session.id) {
      this.expandedSessionId.set(null);
      this.destroyMap();
    } else {
      this.expandedSessionId.set(session.id);
      setTimeout(() => this.initMap(session), 0);
    }
  }

  private async initMap(session: Session) {
    if (!isPlatformBrowser(this.platformId)) return;
    this.destroyMap();
    const L = await import('leaflet');
    const containerRef = this.mapContainers.find(c => c.nativeElement.dataset['sessionId'] === session.id);
    if (!containerRef) return;
    const element = containerRef.nativeElement;
    const lat = session.latitude || 18.4861;
    const lng = session.longitude || -69.9312;

    this.map = L.map(element, {
        center: [lat, lng],
        zoom: 13,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { attribution: '' }).addTo(this.map);

    L.circleMarker([lat, lng], {
        radius: 8,
        fillColor: '#F97316',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 1
    }).addTo(this.map);
  }

  private destroyMap() {
    if (this.map) {
      this.map.remove();
      this.map = undefined;
    }
  }
}
