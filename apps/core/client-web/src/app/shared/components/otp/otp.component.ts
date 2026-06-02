import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  Input,
  Output,
  EventEmitter,
  ViewChildren,
  QueryList,
  ElementRef,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Shield, Clock, RefreshCw, Eraser, CheckCircle, Info, AlertCircle, AlertTriangle, Lightbulb } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

type StatusType = 'success' | 'error' | 'warning' | 'info';
interface OtpStatus {
  message: string;
  type: StatusType;
}

/** Threshold (seconds remaining) below which the timer is shown as "expiring". */
const EXPIRING_THRESHOLD = 30;
/** How long transient (error/info) status messages stay visible. */
const STATUS_AUTO_DISMISS_MS = 5000;
/** How long the error shake/highlight is shown. */
const ERROR_FLASH_MS = 3000;
/** Allowed OTP lengths offered by the optional length selector. */
const SELECTABLE_LENGTHS = [4, 6, 8] as const;

@Component({
  selector: 'app-otp',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './otp.component.html',
  styleUrls: ['./otp.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OtpComponent implements OnInit, OnChanges, OnDestroy {
  // ── Inputs ──────────────────────────────────────────────
  @Input() otpLength = 6;
  @Input() timerDuration = 120; // seconds
  @Input() resendCooldown = 30; // seconds
  @Input() title = 'Verificación de Seguridad';
  @Input() description = 'Para proteger su cuenta, hemos enviado un código de verificación a su correo electrónico registrado.';
  @Input() showLengthSelector = false;
  @Input() mode: 'email' | 'app' = 'email';

  // ── Outputs ─────────────────────────────────────────────
  @Output() verify = new EventEmitter<string>();
  @Output() resend = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  // ── State ───────────────────────────────────────────────
  /** Effective number of digits (decoupled from the @Input so the selector can change it). */
  readonly length = signal(6);
  readonly otpValues = signal<string[]>([]);
  readonly timer = signal(0);
  readonly cooldown = signal(0);
  readonly inputError = signal(false);
  readonly inputsDisabled = signal(false);
  /** True while a verify attempt is in flight, to prevent double submits. */
  readonly verifying = signal(false);
  readonly status = signal<OtpStatus | null>(null);

  @ViewChildren('otpInput') inputs!: QueryList<ElementRef<HTMLInputElement>>;

  /** Whether this instance is time-bounded. Authenticator-app (TOTP) codes never expire here. */
  readonly usesTimer = computed(() => this.mode === 'email');

  readonly isExpired = computed(() => this.usesTimer() && this.timer() <= 0);
  readonly isExpiring = computed(() => this.usesTimer() && this.timer() > 0 && this.timer() <= EXPIRING_THRESHOLD);
  readonly isComplete = computed(() => {
    const values = this.otpValues();
    return values.length === this.length() && values.every(v => v !== '');
  });
  readonly canVerify = computed(() => this.isComplete() && !this.verifying() && !this.inputsDisabled() && !this.isExpired());

  protected readonly selectableLengths = SELECTABLE_LENGTHS;
  protected Math = Math;

  private timerInterval: ReturnType<typeof setInterval> | undefined;
  private cooldownInterval: ReturnType<typeof setInterval> | undefined;
  private readonly pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

  // ── Icons ───────────────────────────────────────────────
  protected readonly ShieldIcon = Shield;
  protected readonly ClockIcon = Clock;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly EraserIcon = Eraser;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly InfoIcon = Info;
  protected readonly AlertCircleIcon = AlertCircle;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly LightbulbIcon = Lightbulb;

  // ── Lifecycle ───────────────────────────────────────────
  ngOnInit(): void {
    this.applyLength(this.otpLength);
    if (this.usesTimer()) {
      this.startTimer();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // React to a parent changing the configured length after init.
    if (changes['otpLength'] && !changes['otpLength'].firstChange) {
      this.applyLength(this.otpLength);
    }
    // Restart the countdown if the duration changes (email mode only).
    if (changes['timerDuration'] && !changes['timerDuration'].firstChange && this.usesTimer()) {
      this.startTimer();
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.stopCooldown();
    this.pendingTimeouts.forEach(id => clearTimeout(id));
    this.pendingTimeouts.clear();
  }

  // ── Timer ───────────────────────────────────────────────
  startTimer(): void {
    this.stopTimer();
    this.timer.set(this.timerDuration);

    this.timerInterval = setInterval(() => {
      this.timer.update(t => {
        if (t <= 1) {
          this.stopTimer();
          this.onExpired();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  }

  stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
  }

  private onExpired(): void {
    this.showStatus('El código OTP ha expirado. Solicite un nuevo código.', 'warning');
    this.markAsError();
    this.disableAllInputs();
  }

  startCooldown(): void {
    this.stopCooldown();
    this.cooldown.set(this.resendCooldown);
    this.cooldownInterval = setInterval(() => {
      this.cooldown.update(c => {
        if (c <= 1) {
          this.stopCooldown();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  stopCooldown(): void {
    if (this.cooldownInterval) {
      clearInterval(this.cooldownInterval);
      this.cooldownInterval = undefined;
    }
  }

  formatTimer(seconds: number): string {
    const safe = Math.max(0, seconds);
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // ── Input handling ──────────────────────────────────────
  handleInput(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.replace(/\s+/g, '');

    // The user is actively editing — any previous submit attempt is stale.
    this.verifying.set(false);

    if (raw === '') {
      this.setDigit(index, '');
      this.status.set(null);
      return;
    }

    if (!/^\d+$/.test(raw)) {
      // Reject and restore the box to whatever the model says it should be.
      input.value = this.otpValues()[index] ?? '';
      this.showStatus('Por favor, ingrese solo números', 'error');
      return;
    }

    // A single keystroke fills one box and advances. Multi-character input
    // (browser/SMS autofill injecting the whole code) is distributed across boxes.
    const lastFilled = this.fill(raw, index);
    this.focusInput(Math.min(lastFilled + 1, this.length() - 1));
    this.status.set(null);
  }

  handleKeyDown(event: KeyboardEvent, index: number): void {
    const key = event.key;

    if (key === 'ArrowRight' || key === 'ArrowDown') {
      event.preventDefault();
      this.focusInput(index + 1);
    } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      event.preventDefault();
      this.focusInput(index - 1);
    } else if (key === 'Backspace') {
      const values = this.otpValues();
      if (values[index] !== '') {
        // Clear the current box but keep focus so the user can retype.
        event.preventDefault();
        this.setDigit(index, '');
      } else if (index > 0) {
        // Empty box: step back and clear the previous one.
        event.preventDefault();
        this.setDigit(index - 1, '');
        this.focusInput(index - 1);
      }
    } else if (key === 'Delete') {
      event.preventDefault();
      this.setDigit(index, '');
    }
  }

  handlePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasteData = event.clipboardData?.getData('text').replace(/\s+/g, '');
    if (!pasteData) return;

    if (!/^\d+$/.test(pasteData)) {
      this.showStatus('El código pegado contiene caracteres no válidos. Solo se permiten números.', 'error');
      return;
    }

    this.otpValues.set(new Array(this.length()).fill(''));
    const lastFilled = this.fill(pasteData, 0);
    this.focusInput(Math.min(lastFilled + 1, this.length() - 1));
    this.showStatus('Código pegado correctamente', 'success');
  }

  handleFocus(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  /**
   * Writes the digits of `chars` into the model starting at `start`.
   * Returns the index of the last box that was filled.
   */
  private fill(chars: string, start: number): number {
    const len = this.length();
    const values = [...this.otpValues()];
    let i = start;
    for (const ch of chars) {
      if (i >= len) break;
      values[i] = ch;
      i++;
    }
    this.otpValues.set(values);
    return Math.min(i - 1, len - 1);
  }

  private setDigit(index: number, value: string): void {
    if (index < 0 || index >= this.length()) return;
    const values = [...this.otpValues()];
    values[index] = value;
    this.otpValues.set(values);
  }

  private focusInput(index: number): void {
    if (index < 0 || index >= this.length()) return;
    // Defer so the *ngFor has rendered any newly created inputs (e.g. after paste/length change).
    this.schedule(() => this.inputs?.get(index)?.nativeElement.focus(), 0);
  }

  // ── Actions ─────────────────────────────────────────────
  onResend(): void {
    if (this.cooldown() > 0) return;
    this.startCooldown();
    if (this.usesTimer()) {
      this.startTimer();
    }
    this.resetEntry();
    this.showStatus('Nuevo código OTP enviado', 'info');
    this.focusInput(0);
    this.resend.emit();
  }

  onVerify(): void {
    if (!this.canVerify()) return;
    this.verifying.set(true);
    this.verify.emit(this.otpValues().join(''));
  }

  clear(): void {
    this.resetEntry();
    this.showStatus('Todos los campos han sido limpiados', 'info');
    this.focusInput(0);
  }

  /** Resets the entry to a clean, editable, error-free state. */
  private resetEntry(): void {
    this.otpValues.set(new Array(this.length()).fill(''));
    this.inputError.set(false);
    this.verifying.set(false);
    this.status.set(null);
    this.enableAllInputs();
  }

  clearInputs(): void {
    this.otpValues.set(new Array(this.length()).fill(''));
    this.status.set(null);
  }

  showStatus(message: string, type: StatusType): void {
    this.status.set({ message, type });
    // Transient feedback (error/info) auto-dismisses; success/warning are sticky.
    if (type === 'error' || type === 'info') {
      this.schedule(() => {
        if (this.status()?.message === message) {
          this.status.set(null);
        }
      }, STATUS_AUTO_DISMISS_MS);
    }
  }

  changeLength(length: number): void {
    this.applyLength(length);
    if (this.usesTimer()) {
      this.startTimer();
    }
    this.enableAllInputs();
    this.focusInput(0);
    this.showStatus(`Longitud de OTP cambiada a ${length} dígitos`, 'info');
  }

  private applyLength(length: number): void {
    const safe = Number.isFinite(length) && length > 0 ? Math.floor(length) : 6;
    this.length.set(safe);
    this.otpValues.set(new Array(safe).fill(''));
    this.inputError.set(false);
    this.verifying.set(false);
  }

  // ── Public API for parents (via @ViewChild) ─────────────
  handleError(message: string): void {
    this.verifying.set(false);
    this.showStatus(message, 'error');
    this.markAsError();
  }

  handleSuccess(message: string): void {
    // Stop the countdown so a later expiry can't clobber the success state.
    this.stopTimer();
    this.verifying.set(false);
    this.showStatus(message, 'success');
    this.disableAllInputs();
  }

  markAsError(): void {
    this.inputError.set(true);
    this.schedule(() => this.inputError.set(false), ERROR_FLASH_MS);
  }

  disableAllInputs(): void {
    this.inputsDisabled.set(true);
  }

  enableAllInputs(): void {
    this.inputsDisabled.set(false);
  }

  trackByIndex(index: number): number {
    return index;
  }

  /** Registers a timeout that is automatically cancelled on destroy. */
  private schedule(fn: () => void, delay: number): void {
    const id = setTimeout(() => {
      this.pendingTimeouts.delete(id);
      fn();
    }, delay);
    this.pendingTimeouts.add(id);
  }
}
