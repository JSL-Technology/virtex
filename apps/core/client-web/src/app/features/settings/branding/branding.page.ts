import { Component, DestroyRef, OnInit, inject, signal, ChangeDetectionStrategy, computed, input } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule, Image, Trash2 } from 'lucide-angular';
import { BrandingService, UiFont } from '../../../core/services/branding';
import { ThemeService } from '../../../core/services/theme';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { LivePreview } from '../../../shared/components/live-preview/live-preview';
import { LanguageSelector } from '../../../shared/components/language-selector/language-selector';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { SettingsActionsDirective, SettingsChanges, SettingsSaveBarComponent, SettingsShellService } from '../shell';

/**
 * Two sections in one component, because they draw the same tokens: the person's own
 * **preferences** (language, theme, contrast, density, width — theirs, on this device, applied at
 * once) and the company's **brand** (logo, accent colour, typeface, corners — everyone's, saved to
 * the server, previewed until saved).
 *
 * They were one screen called «Personalización avanzada»: an administrator choosing the company
 * colour also set their own density, the density applied at once but «Save» stayed grey, and the
 * brand itself was kept only in that administrator's browser.
 */
@Component({
  selector: 'app-branding-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    LucideAngularModule,
    LivePreview,
    LanguageSelector,
    TranslateModule,
    SettingsActionsDirective,
    SettingsSaveBarComponent,
    ...VX_FORM_A11Y,
  ],
  templateUrl: './branding.page.html',
  styleUrls: ['./branding.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandingPage implements OnInit {
  private fb = inject(FormBuilder);
  public brandingService = inject(BrandingService);
  public themeService = inject(ThemeService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly shell = inject(SettingsShellService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  /** `personal`: this person's preferences. `company`: the company's brand. */
  readonly view = input<'personal' | 'company'>('company');

  protected readonly ImageIcon = Image;
  protected readonly RemoveIcon = Trash2;

  brandingForm!: FormGroup;
  protected readonly saving = signal(false);
  protected readonly uploading = signal(false);
  protected readonly canEdit = computed(() => this.shell?.canEdit() ?? true);
  /** The company brand being previewed differs from the one saved. */
  protected readonly dirty = computed(() => this.view() === 'company' && this.brandingService.previewDiffers());

  private readonly changes: SettingsChanges = {
    dirty: this.dirty,
    save: () => this.saveAsync(),
    discard: () => this.discard(),
  };

  //  Preselección de acentos. Cada uno alcanza al menos 4.5:1 con texto blanco,
  //  de modo que elegir cualquiera de ellos produce botones legibles sin
  //  depender del ajuste automático de contraste.
  colorPresets = ['#5b37d9', '#0d7d6c', '#1d4ed8', '#b4530a', '#be2a5c', '#3f4a5c'];
  /**
   * The typefaces on offer, each with the kind of face it is.
   *
   * The name and the description are separate because only one of them is language. "Poppins" is a
   * proper noun and is Poppins in every locale; "Geométrica Sans-serif" is a sentence, and it was
   * written into the option text, so an English interface offered "Poppins (Geométrica
   * Sans-serif)" and a Portuguese one the same. The template joins them.
   */
  readonly fonts: { id: UiFont; styleKey: string }[] = [
    { id: 'Inter', styleKey: 'settings.branding.font_style.modern_sans' },
    { id: 'Poppins', styleKey: 'settings.branding.font_style.geometric_sans' },
    { id: 'Lato', styleKey: 'settings.branding.font_style.friendly_sans' },
    { id: 'Roboto', styleKey: 'settings.branding.font_style.standard_sans' },
    { id: 'Open Sans', styleKey: 'settings.branding.font_style.humanist_sans' },
    { id: 'Nunito', styleKey: 'settings.branding.font_style.rounded_sans' },
    { id: 'Roboto Slab', styleKey: 'settings.branding.font_style.serif' },
    { id: 'Merriweather', styleKey: 'settings.branding.font_style.classic_serif' },
    { id: 'Playfair Display', styleKey: 'settings.branding.font_style.elegant_serif' },
    { id: 'Source Code Pro', styleKey: 'settings.branding.font_style.monospace' },
  ];

  ngOnInit(): void {
    const current = this.brandingService.settings();
    this.brandingForm = this.fb.group({
      accentColor: [current.accentColor],
      fontFamily: [current.fontFamily],
      borderRadius: [current.borderRadius],
    });
    if (!this.canEdit()) this.brandingForm.disable({ emitEvent: false });

    // The preview follows the form; nothing is saved until «Save».
    this.brandingForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((values) => {
      this.brandingService.updateSettings(values);
    });

    if (this.view() === 'company') {
      // What the server holds, not what this browser last cached.
      this.brandingService.loadFromServer().subscribe(() => this.syncForm());
      if (this.shell) {
        this.shell.register(this.changes);
        this.destroyRef.onDestroy(() => {
          this.shell?.unregister(this.changes);
          // Leaving without saving must not leave a preview applied to the whole application.
          if (this.brandingService.previewDiffers()) this.brandingService.discardPreview();
        });
      }
    }
  }

  // ── Personal ────────────────────────────────────────────────────────────

  setDensity(density: 'compact' | 'comfy'): void {
    this.brandingService.setPersonal({ density });
  }

  setContentWidth(contentWidth: 'normal' | 'wide'): void {
    this.brandingService.setPersonal({ contentWidth });
  }

  // ── Company ─────────────────────────────────────────────────────────────

  pickPreset(color: string): void {
    this.brandingForm.get('accentColor')?.setValue(color);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploading.set(true);
    this.brandingService.uploadLogo(file).subscribe({
      next: () => {
        this.uploading.set(false);
        this.notifications.showSuccess('settings.branding.logo_saved');
      },
      error: (error: unknown) => {
        this.uploading.set(false);
        this.notifications.showHttpError(error, 'settings.branding.logo_failed');
      },
    });
  }

  async removeLogo(): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'settings.branding.remove_logo_title',
      message: 'settings.branding.remove_logo_message',
      confirmText: 'settings.branding.remove_logo',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.brandingService.removeLogo().subscribe({
      error: (error: unknown) => this.notifications.showHttpError(error, 'settings.branding.logo_failed'),
    });
  }

  saveBranding(): void {
    void this.saveAsync();
  }

  saveAsync(): Promise<boolean> {
    if (!this.canEdit()) return Promise.resolve(false);
    this.saving.set(true);
    return new Promise((resolve) =>
      this.brandingService.saveCompany().subscribe({
        next: () => {
          this.saving.set(false);
          this.notifications.showSuccess('settings.branding.saved_for_everyone');
          resolve(true);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'settings.branding.save_failed');
          resolve(false);
        },
      }),
    );
  }

  discard(): void {
    this.brandingService.discardPreview();
    this.syncForm();
  }

  async resetBranding(): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'settings.branding.reset_title',
      message: 'settings.branding.reset_message',
      confirmText: 'settings.branding.reset',
      variant: 'warning',
    });
    if (!confirmed) return;
    this.brandingService.resetCompany().subscribe({
      next: () => {
        this.syncForm();
        this.notifications.showSuccess('settings.branding.reset_done');
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'settings.branding.save_failed'),
    });
  }

  private syncForm(): void {
    const settings = this.brandingService.settings();
    this.brandingForm.patchValue(
      { accentColor: settings.accentColor, fontFamily: settings.fontFamily, borderRadius: settings.borderRadius },
      { emitEvent: false },
    );
    this.brandingForm.markAsPristine();
  }
}
