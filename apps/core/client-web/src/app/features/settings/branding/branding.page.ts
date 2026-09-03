import { Component, OnInit, inject, signal, ChangeDetectionStrategy, effect } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Save, Image } from 'lucide-angular';
import { BrandingService, UiFont } from '../../../core/services/branding';
import { ThemeService } from '../../../core/services/theme';
import { LivePreview } from '../../../shared/components/live-preview/live-preview';
import { LanguageSelector } from '../../../shared/components/language-selector/language-selector';
import { TranslateModule } from '@ngx-translate/core';
// import { LivePreview } from '../../../shared/components/live-preview/live-preview'; // Importar el nuevo componente

@Component({
  selector: 'app-branding-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule, LivePreview, LanguageSelector, TranslateModule  ], // Añadir LivePreview
  templateUrl: './branding.page.html',
  styleUrls: ['./branding.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandingPage implements OnInit {
  private fb = inject(FormBuilder);
  public brandingService = inject(BrandingService);
  public themeService = inject(ThemeService);

  protected readonly SaveIcon = Save;
  protected readonly ImageIcon = Image;
  
  brandingForm!: FormGroup;
  logoPreview = signal<string | ArrayBuffer | null>(null);
  
  //  Preselección de acentos. Cada uno alcanza al menos 4.5:1 con texto blanco,
  //  de modo que elegir cualquiera de ellos produce botones legibles sin
  //  depender del ajuste automático de contraste.
  colorPresets = ['#5b37d9', '#0d7d6c', '#1d4ed8', '#b4530a', '#be2a5c', '#3f4a5c'];
  // fonts: { id: UiFont, name: string }[] = [
  //   { id: 'Inter', name: 'Inter (Sans-serif)' },
  //   { id: 'Roboto Slab', name: 'Roboto Slab (Serif)' },
  //   { id: 'Source Code Pro', name: 'Source Code Pro (Monospace)' },
  // ];

    fonts: { id: UiFont, name: string }[] = [
    { id: 'Inter', name: 'Inter (Moderna Sans-serif)' },
    { id: 'Poppins', name: 'Poppins (Geométrica Sans-serif)' },
    { id: 'Lato', name: 'Lato (Amigable Sans-serif)' },
    { id: 'Roboto', name: 'Roboto (Estándar Sans-serif)' },
    { id: 'Open Sans', name: 'Open Sans (Humanista Sans-serif)' },
    { id: 'Nunito', name: 'Nunito (Redondeada Sans-serif)' },
    { id: 'Roboto Slab', name: 'Roboto Slab (Serif)' },
    { id: 'Merriweather', name: 'Merriweather (Clásica Serif)' },
    { id: 'Playfair Display', name: 'Playfair Display (Elegante Serif)' },
    { id: 'Source Code Pro', name: 'Source Code Pro (Monospace)' },];
  
  ngOnInit(): void {
    const currentSettings = this.brandingService.settings();
    this.logoPreview.set(currentSettings.logoUrl);
    
    this.brandingForm = this.fb.group({
      accentColor: [currentSettings.accentColor],
      fontFamily: [currentSettings.fontFamily],
      borderRadius: [currentSettings.borderRadius],
      density: [currentSettings.density],
      contentWidth: [currentSettings.contentWidth],
      layoutStyle: [currentSettings.layoutStyle],
    });

    // Actualiza el servicio en tiempo real para la vista previa
    this.brandingForm.valueChanges.subscribe(values => {
      this.brandingService.updateSettings(values);
    });
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.brandingService.updateLogo(file);
      // Creamos una URL temporal para el preview inmediato sin esperar a localStorage
      this.logoPreview.set(URL.createObjectURL(file));
      this.brandingForm.markAsDirty();
    }
  }

  saveBranding(): void {
    //  El servicio ya persiste en cada cambio para alimentar la vista previa en
    //  vivo; este botón solo confirma al usuario que lo aplicado es definitivo.
    this.brandingForm.markAsPristine();
  }

  resetBranding(): void {
    this.brandingService.resetToDefaults();
    this.brandingForm.patchValue(this.brandingService.settings(), { emitEvent: false });
    this.brandingForm.markAsPristine();
  }
}