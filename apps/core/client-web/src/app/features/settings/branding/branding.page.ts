import { Component, OnInit, inject, signal, ChangeDetectionStrategy, effect } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Save, Image } from 'lucide-angular';
import { BrandingService, UiDensity, UiFont, UiMode, ContentWidth, LayoutStyle } from '../../../core/services/branding';
import { LivePreview } from '../../../shared/components/live-preview/live-preview';
import { LanguageSelector } from '../../../shared/components/language-selector/language-selector';
import { TranslateModule } from '@ngx-translate/core';
// import { LivePreview } from '../../shared/components/live-preview/live-preview'; // Importar el nuevo componente

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

  protected readonly SaveIcon = Save;
  protected readonly ImageIcon = Image;
  
  brandingForm!: FormGroup;
  logoPreview = signal<string | ArrayBuffer | null>(null);
  
  // Paleta de colores predefinidos para facilitar la elección
  colorPresets = ['#0078d4', '#d83b01', '#107c10', '#5c2d91', '#e3008c', '#333333'];
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
      grayColor: [currentSettings.grayColor],
      fontFamily: [currentSettings.fontFamily],
      borderRadius: [currentSettings.borderRadius],
      density: [currentSettings.density],
      uiMode: [currentSettings.uiMode],
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
    // La data ya se guarda en tiempo real en localStorage a través del `effect` en el servicio.
    // Este botón sirve para dar feedback al usuario de que la acción se completó.
    this.brandingForm.markAsPristine();
    console.log("Configuración guardada.", this.brandingService.settings());
  }
}