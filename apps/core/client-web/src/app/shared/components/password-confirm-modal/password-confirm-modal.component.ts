
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { LucideAngularModule, Lock, X, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth';
import { NotificationService } from '../../../core/services/notification';

@Component({
  selector: 'app-password-confirm-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    LucideAngularModule,
    TranslateModule
  ],
  template: `
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
         role="dialog"
         aria-modal="true"
         aria-labelledby="modal-title">
      <div class="w-full max-w-md overflow-hidden bg-card border border-border rounded-xl shadow-2xl animate-in zoom-in-95 duration-200">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-primary/10 rounded-lg text-primary">
              <lucide-icon [name]="'lock'" [size]="20"></lucide-icon>
            </div>
            <h3 id="modal-title" class="text-lg font-semibold text-foreground">
              {{ 'AUTH.STEP_UP.TITLE' | translate }}
            </h3>
          </div>
          <button (click)="cancel()"
                  class="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors"
                  aria-label="Cerrar">
            <lucide-icon [name]="'x'" [size]="20"></lucide-icon>
          </button>
        </div>

        <!-- Body -->
        <div class="p-6 space-y-4">
          <p class="text-sm text-muted-foreground leading-relaxed">
            {{ 'AUTH.STEP_UP.DESCRIPTION' | translate }}
          </p>

          <form [formGroup]="passwordForm" (ngSubmit)="confirm()" class="space-y-4">
            <div class="space-y-2">
              <label for="current-password" class="text-sm font-medium text-foreground block">
                {{ 'AUTH.STEP_UP.PASSWORD_LABEL' | translate }}
              </label>
              <div class="relative group">
                <input [type]="showPassword() ? 'text' : 'password'"
                       id="current-password"
                       formControlName="password"
                       class="w-full px-4 py-2.5 bg-background border border-input rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all pr-10 outline-none"
                       [placeholder]="'AUTH.STEP_UP.PASSWORD_PLACEHOLDER' | translate"
                       [attr.aria-invalid]="passwordForm.get('password')?.invalid && passwordForm.get('password')?.touched"
                       autocomplete="current-password"
                       #passwordInput>
                <button type="button"
                        (click)="togglePassword()"
                        class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-primary transition-colors focus:outline-none"
                        [attr.aria-label]="(showPassword() ? 'AUTH.STEP_UP.HIDE_PASSWORD' : 'AUTH.STEP_UP.SHOW_PASSWORD') | translate">
                  <lucide-icon [name]="showPassword() ? 'eye-off' : 'eye'" [size]="18"></lucide-icon>
                </button>
              </div>
              <div *ngIf="errorMessage()" class="flex items-center gap-2 text-xs text-destructive mt-1 animate-in slide-in-from-top-1">
                <lucide-icon [name]="'alert-circle'" [size]="14"></lucide-icon>
                <span>{{ errorMessage() }}</span>
              </div>
            </div>

            <!-- Footer -->
            <div class="pt-4 flex flex-col-reverse sm:flex-row gap-3">
              <button type="button"
                      (click)="cancel()"
                      [disabled]="isLoading()"
                      class="w-full sm:flex-1 px-4 py-2.5 bg-muted text-muted-foreground font-medium rounded-lg hover:bg-muted/80 hover:text-foreground transition-all disabled:opacity-50">
                {{ 'COMMON.CANCEL' | translate }}
              </button>
              <button type="submit"
                      [disabled]="passwordForm.invalid || isLoading()"
                      class="w-full sm:flex-1 px-4 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none group">
                <lucide-icon *ngIf="isLoading()" [name]="'loader-2'" [size]="18" class="animate-spin"></lucide-icon>
                <span>{{ (isLoading() ? 'COMMON.VERIFYING' : 'COMMON.CONFIRM') | translate }}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class PasswordConfirmModalComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);

  passwordForm = this.fb.group({
    password: ['', [Validators.required]]
  });

  isLoading = signal(false);
  showPassword = signal(false);
  errorMessage = signal<string | null>(null);

  // Resolved via StepUpService
  resolve!: (token: string) => void;
  reject!: (reason: any) => void;
  scope!: string;

  togglePassword() {
    this.showPassword.update(v => !v);
  }

  async confirm() {
    if (this.passwordForm.invalid) return;

    this.isLoading.set(true);
    this.errorMessage.set(null);

    const password = this.passwordForm.get('password')?.value;

    try {
      const response = await firstValueFrom(this.authService.verifyPassword(password!, this.scope));
      if (response && response.stepUpToken) {
        this.resolve(response.stepUpToken);
      } else {
        throw new Error('No se recibió el token de verificación.');
      }
    } catch (error: any) {
      const msg = error.error?.message || 'Contraseña incorrecta o error de verificación.';
      this.errorMessage.set(msg);
      this.passwordForm.get('password')?.reset();
    } finally {
      this.isLoading.set(false);
    }
  }

  cancel() {
    this.reject('Canceled by user');
  }
}
