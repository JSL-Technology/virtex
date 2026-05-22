import { Injectable, signal, effect, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DOCUMENT } from '@angular/common';

// Definimos los tipos para las opciones de personalización
export type UiDensity = 'compact' | 'comfy';
// export type UiFont = 'Inter' | 'Roboto Slab' | 'Source Code Pro';
export type UiFont = 
  'Inter' | 'Roboto Slab' | 'Source Code Pro' | 
  'Lato' | 'Montserrat' | 'Merriweather' | 'Poppins' |
  'Roboto' | 'Open Sans' | 'Playfair Display' | 'Nunito';
export type UiMode = 'light' | 'dark' | 'contrast';
export type ContentWidth = 'normal' | 'wide';
export type LayoutStyle = 'topnav' | 'sidenav';

export interface BrandingSettings {
  accentColor: string;
  grayColor: string;
  fontFamily: UiFont;
  borderRadius: number;
  density: UiDensity;
  logoUrl: string | null;
  uiMode: UiMode;
  contentWidth: ContentWidth;
  layoutStyle: LayoutStyle;
}

@Injectable({ providedIn: 'root' })
export class BrandingService {
  private platformId = inject(PLATFORM_ID);
  private document = inject(DOCUMENT);

  // Señal única para manejar todas las configuraciones
  settings = signal<BrandingSettings>(this.loadSettings());

  constructor() {
    // El efecto se suscribe a CUALQUIER cambio en las configuraciones
    effect(() => {
      const currentSettings = this.settings();
      this.saveSettings(currentSettings);
      this.applyStylesToDom(currentSettings);
    });
  }

  // Carga las configuraciones desde localStorage o establece los valores por defecto
  private loadSettings(): BrandingSettings {
    const defaults: BrandingSettings = {
      accentColor: '#0078d4',
      grayColor: '#6b7280',
      fontFamily: 'Inter',
      borderRadius: 6,
      density: 'comfy',
      logoUrl: null,
      uiMode: 'light',
      contentWidth: 'normal',
      layoutStyle: 'topnav',
    };
    if (isPlatformBrowser(this.platformId)) {
      const saved = localStorage.getItem('branding_settings');
      const savedLogo = localStorage.getItem('branding_logoUrl');
      if (saved) {
        return { ...defaults, ...JSON.parse(saved), logoUrl: savedLogo };
      }
    }
    return defaults;
  }

  // Guarda las configuraciones en localStorage
  private saveSettings(settings: BrandingSettings): void {
    if (isPlatformBrowser(this.platformId)) {
      const { logoUrl, ...rest } = settings;
      localStorage.setItem('branding_settings', JSON.stringify(rest));
      if (logoUrl) localStorage.setItem('branding_logoUrl', logoUrl);
    }
  }

  // El método principal que inyecta los estilos en el DOM
  private applyStylesToDom(settings: BrandingSettings): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Aplica la clase de modo al body
    this.document.body.classList.remove('theme-light', 'theme-dark', 'mode-contrast');
    this.document.body.classList.add(`theme-${settings.uiMode === 'dark' ? 'dark' : 'light'}`);
    if (settings.uiMode === 'contrast') {
      this.document.body.classList.add('mode-contrast');
    }

    const accentPalette = this.generateColorShades(settings.accentColor);
    const grayPalette = this.generateColorShades(settings.grayColor);
    const accentText = this.getContrastColor(settings.accentColor);

    // Variables de espaciado basadas en la densidad
    const spacing = settings.density === 'compact' ?
      { base: 8, input: 8, padding: 12 } :
      { base: 10, input: 10, padding: 16 };

    const styleTagId = 'dynamic-branding-palette';
    let styleTag = this.document.getElementById(styleTagId) as HTMLStyleElement;
    if (!styleTag) {
      styleTag = this.document.createElement('style');
      styleTag.id = styleTagId;
      this.document.head.appendChild(styleTag);
    }

    // Inyectamos un conjunto completo de variables CSS
    styleTag.innerHTML = `
      :root {
        /* Paleta de Acento */
        ${Object.entries(accentPalette).map(([key, value]) => `--accent-${key}: ${value};`).join('\n')}
        /* Paleta de Grises (Neutral) */
        ${Object.entries(grayPalette).map(([key, value]) => `--gray-${key}: ${value};`).join('\n')}
        
        /* Variables Semánticas */
        --accent-primary: var(--accent-500);
        --accent-primary-hover: var(--accent-600);
        --accent-text: ${accentText};
        --focus-shadow: ${this.hexToRgba(settings.accentColor, 0.3)};
        --border-focus: var(--accent-500);

        /* Tipografía */
        --font-family-sans: '${settings.fontFamily}', sans-serif;

        /* Bordes y Layout */
        --border-radius-sm: ${settings.borderRadius * 0.66}px;
        --border-radius-md: ${settings.borderRadius}px;
        --border-radius-lg: ${settings.borderRadius * 1.5}px;
        --content-max-width: ${settings.contentWidth === 'wide' ? '1600px' : '1280px'};

        /* Densidad y Espaciado */
        --space-base: ${spacing.base}px;
        --space-input-y: ${spacing.input}px;
        --space-padding: ${spacing.padding}px;
      }
    `;
  }

  // Método para actualizar una o más configuraciones
  updateSettings(newSettings: Partial<BrandingSettings>): void {
    this.settings.update(current => ({ ...current, ...newSettings }));
  }

  updateLogo(newLogoFile: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      this.settings.update(current => ({ ...current, logoUrl: url }));
    };
    reader.readAsDataURL(newLogoFile);
  }

  // --- Helpers de Color Avanzados ---
  private getContrastColor = (hex: string) => (parseInt(hex.replace('#', ''), 16) > 0xffffff / 2) ? '#000' : '#fff';
  private hexToRgba = (h: string, a: number) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;

  // Genera 10 tonos de un color base, desde claro (50) a oscuro (900)
  private generateColorShades(hex: string): Record<number, string> {
    const mix = (c1: string, c2: string, weight: number) => {
      const d2h = (d: number) => d.toString(16);
      const h2d = (h: string) => parseInt(h, 16);
      let result = "#";
      for (let i = 1; i < 7; i += 2) {
        const c1p = h2d(c1.substr(i, 2));
        const c2p = h2d(c2.substr(i, 2));
        const p = Math.floor(c1p * (1 - weight) + c2p * weight);
        result += ('00' + d2h(p)).slice(-2);
      }
      return result;
    };
    return {
      50: mix('#ffffff', hex, 0.1), 100: mix('#ffffff', hex, 0.2),
      200: mix('#ffffff', hex, 0.4), 300: mix('#ffffff', hex, 0.6),
      400: mix('#ffffff', hex, 0.8), 500: hex,
      600: mix('#000000', hex, 0.1), 700: mix('#000000', hex, 0.2),
      800: mix('#000000', hex, 0.3), 900: mix('#000000', hex, 0.4),
    };
  }
}