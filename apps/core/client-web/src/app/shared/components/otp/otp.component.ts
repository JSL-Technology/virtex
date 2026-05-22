import { Component, ChangeDetectionStrategy, signal, computed, Input, Output, EventEmitter, ViewChildren, QueryList, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Shield, Clock, RefreshCw, Eraser, CheckCircle, Info, AlertCircle, AlertTriangle, Lightbulb } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-otp',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './otp.component.html',
  styleUrls: ['./otp.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OtpComponent implements OnInit, OnDestroy {
  // Inputs
  @Input() otpLength = 6;
  @Input() timerDuration = 120; // seconds
  @Input() resendCooldown = 30; // seconds
  @Input() title = 'Verificación de Seguridad';
  @Input() description = 'Para proteger su cuenta, hemos enviado un código de verificación a su correo electrónico registrado.';
  @Input() showLengthSelector = false;
  @Input() mode: 'email' | 'app' = 'email';

  // Outputs
  @Output() verify = new EventEmitter<string>();
  @Output() resend = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  // State
  otpValues = signal<string[]>([]);
  timer = signal(120);
  cooldown = signal(0);
  inputError = signal(false);
  inputsDisabled = signal(false);

  status = signal<{ message: string, type: 'success' | 'error' | 'warning' | 'info' } | null>(null);

  @ViewChildren('otpInput') inputs!: QueryList<ElementRef<HTMLInputElement>>;

  isExpired = computed(() => this.timer() <= 0);
  isExpiring = computed(() => this.timer() > 0 && this.timer() <= 30);
  isComplete = computed(() => this.otpValues().every(v => v !== ''));

  protected Math = Math;

  private timerInterval: ReturnType<typeof setInterval> | undefined;
  private cooldownInterval: ReturnType<typeof setInterval> | undefined;

  // Icons
  protected readonly ShieldIcon = Shield;
  protected readonly ClockIcon = Clock;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly EraserIcon = Eraser;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly InfoIcon = Info;
  protected readonly AlertCircleIcon = AlertCircle;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly LightbulbIcon = Lightbulb;

  ngOnInit() {
    this.timer.set(this.timerDuration);
    this.otpValues.set(new Array(this.otpLength).fill(''));
    this.startTimer();
  }

  ngOnDestroy() {
    this.stopTimer();
    this.stopCooldown();
  }

  startTimer() {
    this.stopTimer();
    this.timer.set(this.timerDuration);

    this.timerInterval = setInterval(() => {
        this.timer.update(t => {
            if (t <= 1) {
                this.stopTimer();
                this.showStatus('El código OTP ha expirado. Solicite un nuevo código.', 'warning');
                this.markAsError();
                this.disableAllInputs();
                return 0;
            }
            return t - 1;
        });
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  startCooldown() {
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

  stopCooldown() {
      if (this.cooldownInterval) clearInterval(this.cooldownInterval);
  }

  formatTimer(seconds: number): string {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  handleInput(event: Event, index: number) {
      const input = event.target as HTMLInputElement;
      const value = input.value.trim();

      if (!/^\d*$/.test(value)) {
          input.value = '';
          this.showStatus('Por favor, ingrese solo números', 'error');
          return;
      }

      const currentValues = [...this.otpValues()];

      if (value.length >= 1) {
          const char = value.slice(-1);
          currentValues[index] = char;
          input.value = char;

          if (index < this.otpLength - 1) {
              this.inputs.get(index + 1)?.nativeElement.focus();
          }
      } else {
          currentValues[index] = '';
      }

      this.otpValues.set(currentValues);
      this.status.set(null);
  }

  handleKeyDown(event: KeyboardEvent, index: number) {
      const key = event.key;

      if (key === 'ArrowRight' || key === 'ArrowDown') {
          event.preventDefault();
          if (index < this.otpLength - 1) {
              this.inputs.get(index + 1)?.nativeElement.focus();
          }
      } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
          event.preventDefault();
          if (index > 0) {
              this.inputs.get(index - 1)?.nativeElement.focus();
          }
      } else if (key === 'Backspace') {
           const currentValues = [...this.otpValues()];
           if (currentValues[index] === '' && index > 0) {
               event.preventDefault();
               const prevInput = this.inputs.get(index - 1)?.nativeElement;
               if (prevInput) {
                 prevInput.focus();
                 currentValues[index - 1] = '';
                 this.otpValues.set(currentValues);
               }
           }
      } else if (key === 'Delete') {
           const currentValues = [...this.otpValues()];
           if (currentValues[index] === '' && index < this.otpLength - 1) {
               event.preventDefault();
               currentValues[index + 1] = '';
               this.otpValues.set(currentValues);
           }
      }
  }

  handlePaste(event: ClipboardEvent) {
      event.preventDefault();
      const pasteData = event.clipboardData?.getData('text').trim();
      if (!pasteData) return;

      if (!/^\d+$/.test(pasteData)) {
          this.showStatus('El código pegado contiene caracteres no válidos. Solo se permiten números.', 'error');
          return;
      }

      this.clearInputs();

      const currentValues = new Array(this.otpLength).fill('');
      const pasteLength = Math.min(pasteData.length, this.otpLength);

      for (let i = 0; i < pasteLength; i++) {
          currentValues[i] = pasteData[i];
      }
      this.otpValues.set(currentValues);

      const focusIndex = Math.min(pasteLength, this.otpLength - 1);
      setTimeout(() => this.inputs.get(focusIndex)?.nativeElement.focus());

      this.showStatus('Código pegado correctamente', 'success');
  }

  handleFocus(event: FocusEvent) {
      (event.target as HTMLInputElement).select();
  }

  onResend() {
      if (this.cooldown() > 0) return;
      this.startCooldown();
      this.startTimer();
      this.clearInputs();
      this.enableAllInputs();
      this.showStatus('Nuevo código OTP enviado', 'info');
      this.resend.emit();
  }

  onVerify() {
      if (this.isExpired() || !this.isComplete()) return;
      const code = this.otpValues().join('');
      this.verify.emit(code);
  }

  clear() {
      this.clearInputs();
      this.enableAllInputs();
      this.showStatus('Todos los campos han sido limpiados', 'info');
      this.inputs.get(0)?.nativeElement.focus();
      this.cancelled.emit();
  }

  clearInputs() {
      this.otpValues.set(new Array(this.otpLength).fill(''));
      this.status.set(null);
  }

  showStatus(message: string, type: 'success' | 'error' | 'warning' | 'info') {
      this.status.set({ message, type });
      if (type !== 'success' && type !== 'warning') {
          setTimeout(() => {
              if (this.status()?.message === message) {
                   this.status.set(null);
              }
          }, 5000);
      }
  }

  changeLength(length: number) {
      this.otpLength = length;
      this.otpValues.set(new Array(length).fill(''));
      this.startTimer();
      this.showStatus(`Longitud de OTP cambiada a ${length} dígitos`, 'info');
  }

  // API for Parents
  handleError(message: string) {
      this.showStatus(message, 'error');
      this.markAsError();
  }

  handleSuccess(message: string) {
      this.showStatus(message, 'success');
      this.disableAllInputs();
  }

  markAsError() {
      this.inputError.set(true);
      setTimeout(() => {
          this.inputError.set(false);
      }, 3000);
  }

  disableAllInputs() {
      this.inputsDisabled.set(true);
  }

  enableAllInputs() {
      this.inputsDisabled.set(false);
  }
}
