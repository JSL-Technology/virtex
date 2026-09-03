import {
  DOCUMENT,
  Injectable,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import {
  Rgb,
  ensureContrast,
  generateScale,
  parseColor,
  readableTextOn,
  toHex,
  toRgbTriplet,
} from '../utils/color';
import { ThemeService } from './theme';

export type UiDensity = 'compact' | 'comfy';
export type ContentWidth = 'normal' | 'wide';
export type LayoutStyle = 'topnav' | 'sidenav';

export type UiFont =
  | 'Inter'
  | 'Roboto Slab'
  | 'Source Code Pro'
  | 'Lato'
  | 'Montserrat'
  | 'Merriweather'
  | 'Poppins'
  | 'Roboto'
  | 'Open Sans'
  | 'Playfair Display'
  | 'Nunito';

/**
 * `uiMode` ya NO forma parte de la marca.
 *
 * Claro/oscuro es una preferencia del USUARIO —cambia según la hora, la
 * pantalla o la vista— mientras que la marca es una configuración de la
 * ORGANIZACIÓN. Mezclarlas hacía que el administrador que ajustaba los colores
 * corporativos impusiera de paso el tema a toda la plantilla.
 *
 * Técnicamente era peor todavía: `BrandingService` guardaba su `uiMode` en
 * `branding_settings` y aplicaba clases `theme-light`/`theme-dark` al `<body>`,
 * mientras `ThemeService` guardaba el suyo en otra clave y ponía `data-theme`
 * en el `<html>`. Dos servicios decidiendo el tema, sin coordinación: ganaba el
 * último que se ejecutase. Esa carrera es la causa directa de la «mezcla de
 * temas» de la interfaz.
 *
 * El tema pertenece ahora en exclusiva a `ThemeService`.
 */
export interface BrandingSettings {
  accentColor: string;
  fontFamily: UiFont;
  borderRadius: number;
  density: UiDensity;
  logoUrl: string | null;
  contentWidth: ContentWidth;
  layoutStyle: LayoutStyle;
}

const SETTINGS_KEY = 'branding_settings';
const LOGO_KEY = 'branding_logoUrl';
const DENSITY_KEY = 'vx-density';
const STYLE_TAG_ID = 'vx-branding-tokens';

const DEFAULTS: BrandingSettings = {
  accentColor: '#5b37d9',   // iris-600, el acento de Virtex
  fontFamily: 'Inter',
  borderRadius: 6,
  density: 'comfy',
  logoUrl: null,
  contentWidth: 'normal',
  layoutStyle: 'topnav',
};

/**
 * =============================================================================
 *  SERVICIO DE MARCA
 * =============================================================================
 *  Personalización por organización: acento, tipografía, radio, densidad y
 *  logotipo.
 *
 *  Actúa SOBRESCRIBIENDO tokens semánticos concretos, nunca redefiniendo la
 *  paleta. Todo lo que no se personaliza sigue viniendo del sistema de diseño,
 *  de forma que una marca personalizada no puede dejar la interfaz a medio
 *  tematizar — que es lo que ocurría cuando este servicio inyectaba
 *  `--accent-500` y `--gray-300` mientras el resto de la aplicación consumía
 *  `--primary` y `--border-color`.
 * =============================================================================
 */
@Injectable({ providedIn: 'root' })
export class BrandingService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly theme = inject(ThemeService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly settings = signal<BrandingSettings>(this.load());

  readonly logoUrl = computed(() => this.settings().logoUrl);

  constructor() {
    effect(() => {
      const settings = this.settings();

      //  Se lee `appliedTheme` para que el efecto vuelva a ejecutarse al
      //  cambiar de tema: el acento derivado depende de si el fondo sobre el
      //  que se dibuja es claro u oscuro.
      const theme = this.theme.appliedTheme();

      this.persist(settings);
      this.apply(settings, theme);
    });
  }

  updateSettings(changes: Partial<BrandingSettings>): void {
    this.settings.update((current) => ({ ...current, ...changes }));
  }

  updateLogo(file: File): void {
    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result;
      if (typeof url === 'string') {
        this.settings.update((current) => ({ ...current, logoUrl: url }));
      }
    };
    reader.readAsDataURL(file);
  }

  resetToDefaults(): void {
    this.settings.set({ ...DEFAULTS });
  }

  /* ── Aplicación ──────────────────────────────────────────────────────────── */

  private apply(settings: BrandingSettings, theme: 'light' | 'dark'): void {
    if (!this.isBrowser) return;

    //  La densidad viaja como atributo, no como variables inyectadas: las
    //  alturas de control ya están tokenizadas en `_scales.scss` bajo
    //  `[data-density='compact']`, así que basta con conmutar el atributo.
    const root = this.document.documentElement;
    if (settings.density === 'compact') {
      root.setAttribute('data-density', 'compact');
    } else {
      root.removeAttribute('data-density');
    }

    this.styleTag().textContent = this.buildTokens(settings, theme);
  }

  private styleTag(): HTMLStyleElement {
    let tag = this.document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
    if (!tag) {
      tag = this.document.createElement('style');
      tag.id = STYLE_TAG_ID;
      this.document.head.appendChild(tag);
    }
    return tag;
  }

  /**
   * Compone las sobrescrituras de token.
   *
   * El punto delicado es que el acento lo elige libremente el cliente en un
   * selector de color, y un mismo color no puede cumplir los dos papeles:
   *
   *   · `--accent-solid` es un RELLENO que lleva texto encima; debe contrastar
   *     con ese texto.
   *   · `--accent-text` es TEXTO sobre la superficie de la aplicación; debe
   *     contrastar con esa superficie.
   *
   * Sobre tema oscuro, un azul marino corporativo funciona como relleno pero
   * desaparece como texto. Se conserva el matiz elegido y se ajusta solo la
   * luminosidad de la variante de texto hasta alcanzar 4.5:1. Así una marca
   * personalizada nunca puede producir texto ilegible.
   */
  private buildTokens(settings: BrandingSettings, theme: 'light' | 'dark'): string {
    const accent = parseColor(settings.accentColor) ?? parseColor(DEFAULTS.accentColor)!;
    const scale = generateScale(accent);

    //  Superficie de referencia de cada tema, para calcular el contraste del
    //  acento textual. Coincide con `--surface-canvas` en `_theme.scss`.
    const surface: Rgb =
      theme === 'dark' ? { r: 14, g: 16, b: 23 } : { r: 244, g: 246, b: 250 };

    const solid = accent;
    const onSolid = readableTextOn(solid);
    const accentText = ensureContrast(accent, surface, 4.5);

    const radius = Math.max(0, Math.min(24, settings.borderRadius));

    return `:root {
  --accent-solid: ${toHex(solid)};
  --accent-solid-hover: ${toHex(theme === 'dark' ? scale[400] : scale[600])};
  --accent-solid-active: ${toHex(theme === 'dark' ? scale[300] : scale[700])};
  --accent-on-solid: ${toHex(onSolid)};
  --accent-solid-rgb: ${toRgbTriplet(solid)};
  --accent-text: ${toHex(accentText)};
  --content-link: ${toHex(accentText)};
  --accent-surface: rgba(${toRgbTriplet(accent)}, ${theme === 'dark' ? 0.14 : 0.08});
  --accent-surface-hover: rgba(${toRgbTriplet(accent)}, ${theme === 'dark' ? 0.2 : 0.14});
  --accent-border: rgba(${toRgbTriplet(accent)}, ${theme === 'dark' ? 0.32 : 0.24});
  --border-focus: ${toHex(accentText)};

  --font-sans: '${settings.fontFamily}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  --radius-sm: ${(radius * 0.66).toFixed(1)}px;
  --radius-md: ${radius}px;
  --radius-lg: ${(radius * 1.6).toFixed(1)}px;
  --radius-xl: ${(radius * 2.3).toFixed(1)}px;

  --content-max-width: ${settings.contentWidth === 'wide' ? '1600px' : '1280px'};
}`;
  }

  /* ── Persistencia ────────────────────────────────────────────────────────── */

  private load(): BrandingSettings {
    if (!this.isBrowser) return { ...DEFAULTS };

    try {
      const storage = this.document.defaultView?.localStorage;
      const raw = storage?.getItem(SETTINGS_KEY);
      const logoUrl = storage?.getItem(LOGO_KEY) ?? null;

      if (!raw) return { ...DEFAULTS, logoUrl };

      const parsed = JSON.parse(raw) as Partial<BrandingSettings> & {
        uiMode?: string;
        grayColor?: string;
      };

      //  Migración de ajustes guardados por la versión anterior: se traslada su
      //  `uiMode` a `ThemeService` una sola vez y se descarta el campo, para
      //  que un usuario existente no pierda el tema que tenía elegido.
      if (parsed.uiMode === 'light' || parsed.uiMode === 'dark') {
        this.theme.setMode(parsed.uiMode);
      } else if (parsed.uiMode === 'contrast') {
        this.theme.setContrast('high');
      }

      //  `grayColor` desaparece: los neutros los fija el sistema de diseño y
      //  son los que garantizan el contraste verificado. Dejar que se
      //  personalizaran permitía a un cliente romper la legibilidad de toda la
      //  aplicación desde un selector de color.
      const { uiMode: _uiMode, grayColor: _grayColor, ...rest } = parsed;

      return { ...DEFAULTS, ...rest, logoUrl };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private persist(settings: BrandingSettings): void {
    if (!this.isBrowser) return;

    try {
      const storage = this.document.defaultView?.localStorage;
      const { logoUrl, ...rest } = settings;

      storage?.setItem(SETTINGS_KEY, JSON.stringify(rest));
      storage?.setItem(DENSITY_KEY, settings.density);

      if (logoUrl) {
        storage?.setItem(LOGO_KEY, logoUrl);
      } else {
        storage?.removeItem(LOGO_KEY);
      }
    } catch {
      /* Almacenamiento no disponible: los ajustes solo duran la sesión. */
    }
  }
}
