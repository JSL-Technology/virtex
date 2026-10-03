import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  inject,
  signal,
  ChangeDetectorRef,
  DestroyRef,
  ViewContainerRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  FormControl,
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import {
  LucideAngularModule,
  User as UserIcon,
  Mail,
  Phone,
  Building2,
  Save,
  Image,
  Shield,
  Check,
} from 'lucide-angular';
import { AuthService } from '../../../core/services/auth';
import { NotificationService } from '../../../core/services/notification';
import { UsersService } from '../../../core/api/users.service';
import { StepUpService, StepUpScope } from '../../../core/services/step-up.service';
import { SecuritySettingsComponent } from '../components/security-settings/security-settings.component';
import { PhoneVerificationModalComponent } from '../components/phone-verification-modal/phone-verification-modal.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { FileUtil } from '../../../shared/utils/file.util';
// H4 FIX: enforce the same password policy as register/reset/set (and the backend) on the
// change-password form, which previously only required minLength(8).
import { strongPasswordValidator } from '../../../shared/validators/password.validator';
import { catchError, of } from 'rxjs';
import { phoneLikeValidator } from '../../../shared/validators/phone-like.validator';
import { toE164 } from '../../../shared/utils/phone.util';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { PasswordStrengthComponent } from '../../../shared/components/password-strength/password-strength.component';

/** «Nueva» y «Confirmar» coinciden. El error vive en el grupo para poder decirlo junto a ambos. */
const passwordsMatchValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const next = group.get('newPassword')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return next && confirm && next !== confirm ? { passwordsMismatch: true } : null;
};
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

// Typed Form Interface
interface ProfileForm {
  firstName: FormControl<string | null>;
  lastName: FormControl<string | null>;
  email: FormControl<string | null>;
  phone: FormControl<string | null>;
  jobTitle: FormControl<string | null>;
  preferredLanguage: FormControl<string | null>;
}

@Component({
  selector: 'app-my-profile-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    LucideAngularModule,
    SecuritySettingsComponent,
    TranslateModule,
    PhoneVerificationModalComponent,
    PasswordStrengthComponent,
    ...VX_FORM_A11Y,
  ],
  templateUrl: './my-profile.page.html',
  styleUrls: ['./my-profile.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyProfilePage implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private usersService = inject(UsersService);
  private notificationService = inject(NotificationService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  private stepUpService = inject(StepUpService);
  private viewContainerRef = inject(ViewContainerRef);
  private readonly locale = inject(LocaleStore);

  // Icons
  protected readonly UserIcon = UserIcon;
  protected readonly MailIcon = Mail;
  protected readonly PhoneIcon = Phone;
  protected readonly CompanyIcon = Building2;
  protected readonly SaveIcon = Save;
  protected readonly ImageIcon = Image;
  protected readonly ShieldIcon = Shield;
  protected readonly CheckIcon = Check;

  profileForm!: FormGroup<ProfileForm>;

  passwordForm!: FormGroup;
  avatarPreview = signal<string | ArrayBuffer | null>(null);

  currentUser = this.authService.currentUser;
  isLoading = false;

  // Phone Verification State
  showPhoneModal = signal(false);

  // Job Titles List (Loaded from backend) with Error Handling
  jobTitles = toSignal(
    this.usersService.getJobTitles().pipe(
      catchError((err) => {
        console.error('Failed to load job titles', err);
        return of([] as string[]);
      })
    ),
    { initialValue: [] }
  );

  ngOnInit(): void {
    const user = this.currentUser();
    const browserLang = navigator.language.split('-')[0];
    const defaultLang = ['es', 'en'].includes(browserLang) ? browserLang : 'es';

    this.profileForm = this.fb.group({
      firstName: [user?.firstName || '', Validators.required],
      lastName: [user?.lastName || '', Validators.required],
      //  Solo lectura: el correo se cambia con su propio flujo de confirmación, nunca por aquí.
      email: [{ value: user?.email || '', disabled: true }],
      //  Opcionales, como en el servidor. Eran obligatorios sin asterisco ni mensaje, y el botón
      //  «Guardar» quedaba gris sin explicación para quien no tenía teléfono (QA A-04).
      phone: [user?.phone || '', phoneLikeValidator],
      jobTitle: [user?.jobTitle || ''],
      preferredLanguage: [user?.preferredLanguage || defaultLang]
    }) as FormGroup<ProfileForm>;

    //  La contraseña actual es obligatoria (QA M-03, OWASP ASVS 2.1.6): el servidor la verifica y
    //  la pedía siempre, pero el formulario no tenía el campo y enviaba `''`, así que cambiar la
    //  contraseña fallaba SIEMPRE.
    this.passwordForm = this.fb.group(
      {
        currentPassword: ['', Validators.required],
        newPassword: ['', [Validators.required, strongPasswordValidator()]],
        confirmPassword: ['', Validators.required],
      },
      { validators: passwordsMatchValidator },
    );

    if (user?.avatarUrl) {
      this.avatarPreview.set(user.avatarUrl);
    }

    this.consumeEmailChangeToken();
  }

  /**
   * Complete a pending email change when the user arrives from the confirmation link.
   *
   * The token travels in the URL fragment so it never reaches a server log, a CDN log or a
   * `Referer` header. It is removed from the address bar immediately after being read, so a
   * refresh or a shared URL cannot replay it.
   */
  private consumeEmailChangeToken(): void {
    const fragment = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const token = new URLSearchParams(fragment).get('email_change_token');
    if (!token) return;

    history.replaceState(null, '', window.location.pathname + window.location.search);

    this.usersService.confirmEmailChange(token).subscribe({
      next: (res) => {
        this.notificationService.showSuccess(res.message);
        // The server bumps tokenVersion on confirmation, so this session is already invalid.
        this.authService.logout();
      },
      error: (err) =>
        this.notificationService.showHttpError(err, 'El enlace de confirmación ha expirado o no es válido. Solicita el cambio de nuevo.'),
    });
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      // 10/10: Use shared utility for validation and reading
      const error = FileUtil.validateImage(file, 2); // 2MB limit
      if (error) {
          this.notificationService.showError(error); // Should ideally be a translation key
          return;
      }

      FileUtil.readFileAsDataUrl(file).then(dataUrl => {
          this.avatarPreview.set(dataUrl);
          this.cdr.markForCheck();
      }).catch(err => console.error('Error reading file', err));

      // Upload via UsersService
      this.usersService.uploadAvatar(file)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
              this.notificationService.showSuccess('settings.profile.avatar_updated');
              this.authService.reloadSession().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
          },
          error: (error: HttpErrorResponse) => {
              if (error.status === 413) {
                 this.notificationService.showError('settings.profile.errors.file_too_large');
              } else {
                 // The server says what was wrong with the file (format, size, content); it used to
                 // be matched by searching an English `message` the API does not send.
                 this.notificationService.showHttpError(error, 'settings.profile.errors.avatar_upload');
              }
          }
      });
    }
  }

  openPhoneVerification() {
    this.showPhoneModal.set(true);
  }

  onPhoneVerified() {
    // Reload user info to update UI state
    this.authService.reloadSession().subscribe();
    this.cdr.markForCheck();
  }

  saveProfile(): void {
    if (this.profileForm.invalid) {
      //  El botón ya no se apaga sin explicación: se marca cada campo y se dice cuál falla.
      this.profileForm.markAllAsTouched();
      this.notificationService.showError('settings.profile.errors.check_fields');
      return;
    }
    {
      this.isLoading = true;
      const { firstName, lastName, preferredLanguage, phone, jobTitle } = this.profileForm.getRawValue();

      //  Sin `email`: el servidor no lo admite en este endpoint (se cambia con su flujo de
      //  confirmación) y enviarlo hacía que TODA edición de perfil respondiera 400 (QA A-04). El
      //  teléfono va en E.164, que es lo que exige la API; en blanco se envía `null` para borrarlo.
      const region = this.locale.tenantContext()?.countryCode ?? 'DO';
      const trimmedPhone = (phone ?? '').trim();
      const e164 = trimmedPhone ? toE164(trimmedPhone, region) : null;
      if (trimmedPhone && !e164) {
        this.isLoading = false;
        this.profileForm.get('phone')?.setErrors({ phone: true });
        this.profileForm.get('phone')?.markAsTouched();
        this.notificationService.showError('settings.profile.errors.invalid_phone');
        return;
      }
      const payload = {
          firstName: (firstName ?? '').trim(),
          lastName: (lastName ?? '').trim(),
          preferredLanguage: preferredLanguage || undefined,
          phone: e164,
          jobTitle: jobTitle || null,
      };

      this.usersService.updateProfile(payload).subscribe({
        next: () => {
          this.notificationService.showSuccess('settings.profile.updated');
          this.authService.reloadSession().subscribe();
          this.profileForm.markAsPristine();
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.notificationService.showHttpError(err, 'settings.profile.errors.update_failed');
          this.isLoading = false;
          this.cdr.markForCheck();
        }
      });
    }
  }

  changePassword(): void {
    //  El botón ya no se deshabilita en silencio: se dice qué falta (QA M-03).
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      this.notificationService.showError(
        this.passwordForm.hasError('passwordsMismatch')
          ? 'settings.profile.errors.passwords_do_not_match'
          : this.passwordForm.get('newPassword')?.hasError('strongPassword')
            ? 'settings.profile.errors.password_too_weak'
            : 'settings.profile.errors.check_fields',
      );
      return;
    }
    const { currentPassword, newPassword } = this.passwordForm.getRawValue();

    this.stepUpService.requireStepUp(StepUpScope.CHANGE_PASSWORD, this.viewContainerRef, () =>
      this.authService.changePassword({ currentPassword: currentPassword ?? '', newPassword: newPassword ?? '' }),
    ).pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe({
      next: () => {
        this.notificationService.showSuccess('settings.profile.password_changed');
        this.passwordForm.reset();
      },
      error: (err) => {
        //  Contraseña actual incorrecta: se dice exactamente eso, sin cerrar la sesión.
        const wrongCurrent =
          err?.status === 400 && err?.error?.code === 'AUTH_INVALID_CREDENTIALS';
        if (wrongCurrent) {
          this.passwordForm.get('currentPassword')?.setErrors({ incorrect: true });
          this.notificationService.showError('settings.profile.errors.current_password_incorrect');
          return;
        }
        this.notificationService.showHttpError(err, 'settings.profile.errors.password_change_failed');
      }
    });
  }

  /** True while the user is entering a new address, so the form can swap in the input. */
  readonly changingEmail = signal(false);
  readonly newEmail = signal('');

  startEmailChange(): void {
    this.newEmail.set('');
    this.changingEmail.set(true);
  }

  cancelEmailChange(): void {
    this.changingEmail.set(false);
    this.newEmail.set('');
  }

  /**
   * Request a change of the account's email address.
   *
   * The backend has had this endpoint, with step-up, a hashed single-use token, a 15-minute TTL
   * and session invalidation, since the two-step flow was introduced — and NOTHING called it.
   * `UsersService.requestEmailChange` existed in the client and no screen invoked it, so the only
   * half of the flow a user could reach was the confirmation link, which they had no way to
   * trigger. Changing your own email was simply not a feature the product offered.
   *
   * The new address is not applied here: the server emails it a confirmation link, and the change
   * lands when that link is followed (see `handleEmailChangeToken` above). The previous address is
   * notified separately, so a hijacked session cannot move the account silently.
   */
  requestEmailChange(): void {
    const newEmail = this.newEmail().trim();
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      this.notificationService.showError('settings.profile.errors.invalid_email');
      return;
    }
    if (newEmail.toLowerCase() === (this.currentUser()?.email ?? '').toLowerCase()) {
      this.notificationService.showError('settings.profile.errors.email_unchanged');
      return;
    }

    this.stepUpService
      .requireStepUp(StepUpScope.CHANGE_EMAIL, this.viewContainerRef, () =>
        // The password field is unused: StepUpGuard has already re-verified identity with the
        // strongest factor the account holds, and the service is told so explicitly.
        this.usersService.requestEmailChange({ newEmail, currentPassword: '' }),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.changingEmail.set(false);
          this.notificationService.showSuccess('settings.profile.email_change_requested');
        },
        error: (err) => {
          this.notificationService.showHttpError(err, 'settings.profile.errors.email_change_failed');
        },
      });
  }
}
