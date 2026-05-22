import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  inject,
  signal,
  ChangeDetectorRef,
  DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  FormControl
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
import { SecuritySettingsComponent } from '../components/security-settings/security-settings.component';
import { PhoneVerificationModalComponent } from '../components/phone-verification-modal/phone-verification-modal.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { FileUtil } from '../../../shared/utils/file.util';
import { catchError, of } from 'rxjs';

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
    PhoneVerificationModalComponent
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
      email: [user?.email || '', [Validators.required, Validators.email]],
      phone: [user?.phone || '', Validators.required],
      jobTitle: [user?.jobTitle || '', Validators.required],
      preferredLanguage: [user?.preferredLanguage || defaultLang]
    }) as FormGroup<ProfileForm>;

    this.passwordForm = this.fb.group({
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    });

    if (user?.avatarUrl) {
      this.avatarPreview.set(user.avatarUrl);
    }
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
              this.notificationService.showSuccess('SETTINGS.PROFILE.AVATAR_UPDATED');
              this.authService.checkAuthStatus().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
          },
          error: (error: HttpErrorResponse) => {
              if (error.status === 413) {
                 this.notificationService.showError('SETTINGS.PROFILE.ERRORS.FILE_TOO_LARGE');
              } else if (error.status === 400 && error.error?.message?.includes('image')) {
                 this.notificationService.showError('SETTINGS.PROFILE.ERRORS.INVALID_FORMAT');
              } else {
                 this.notificationService.showError('SETTINGS.PROFILE.ERRORS.AVATAR_UPLOAD');
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
    this.authService.checkAuthStatus().subscribe();
    this.cdr.markForCheck();
  }

  saveProfile(): void {
    if (this.profileForm.valid) {
      this.isLoading = true;
      const { firstName, lastName, preferredLanguage, email, phone, jobTitle } = this.profileForm.value;

      // Clean payload
      const payload = {
          firstName: firstName!,
          lastName: lastName!,
          preferredLanguage: preferredLanguage!,
          email: email!,
          phone: phone!,
          jobTitle: jobTitle!
      };

      this.usersService.updateProfile(payload).subscribe({
        next: () => {
          this.notificationService.showSuccess('SETTINGS.PROFILE.UPDATED');
          this.authService.checkAuthStatus().subscribe();
          this.profileForm.markAsPristine();
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          console.error(err);
          this.notificationService.showError('SETTINGS.PROFILE.ERRORS.UPDATE_FAILED');
          this.isLoading = false;
          this.cdr.markForCheck();
        }
      });
    }
  }

  changePassword(): void {
    if (this.passwordForm.valid) {
      if (
        this.passwordForm.value.newPassword !==
        this.passwordForm.value.confirmPassword
      ) {
        this.notificationService.showError('SETTINGS.PROFILE.ERRORS.PASSWORDS_DO_NOT_MATCH');
        return;
      }

      this.authService.changePassword(this.passwordForm.value).subscribe({
          next: () => {
              this.notificationService.showSuccess('SETTINGS.PROFILE.PASSWORD_CHANGED');
              this.passwordForm.reset();
          },
          error: (err) => {
              this.notificationService.showError('SETTINGS.PROFILE.ERRORS.PASSWORD_CHANGE_FAILED');
          }
      });
    }
  }
}
