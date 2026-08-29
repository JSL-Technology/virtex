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

/**
 * Preferencia del usuario. `system` no es un tema: es la ausencia de una
 * elección explícita, delegando en el sistema operativo.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** Tema efectivamente pintado, una vez resuelto `system`. */
export type AppliedTheme = 'light' | 'dark';

/** Refuerzo de contraste, ortogonal al tema claro/oscuro. */
export type ContrastMode = 'normal' | 'high';

export const THEME_STORAGE_KEY = 'vx-theme-mode';
export const CONTRAST_STORAGE_KEY = 'vx-contrast-mode';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * =============================================================================
 *  SERVICIO DE TEMA
 * =============================================================================
 *  Gobierna la apariencia claro/oscuro y el refuerzo de contraste.
 *
 *  ── Qué cambia respecto a la implementación anterior ────────────────────────
 *
 *  1. NO SE INTERCAMBIAN HOJAS DE ESTILO.
 *     Antes se reescribía el `href` de `<link id="app-theme">` para cargar
 *     `theme-light.css` o `theme-dark.css`. Eso implicaba una petición de red
 *     en cada cambio de tema y —peor— un destello sin estilos al arrancar,
 *     porque el `<link>` nacía vacío y no se rellenaba hasta que Angular
 *     booteaba. Ambos temas viajan ahora en la hoja principal y cambiar de
 *     tema es mutar un atributo: síncrono, sin red, sin destello.
 *
 *  2. `system` DEJA DE FALSIFICARSE COMO ATRIBUTO.
 *     Antes se escribía siempre el tema resuelto en `data-theme`, así que el
 *     CSS no podía distinguir «el usuario eligió claro» de «el sistema está en
 *     claro». Ahora, en modo `system` el atributo se RETIRA y decide la regla
 *     `@media (prefers-color-scheme: dark)`. Consecuencia valiosa: el tema
 *     correcto se pinta en el primer fotograma, incluso con JavaScript
 *     deshabilitado o aún sin descargar.
 *
 *  3. SE PUBLICA `setMode`, NO SOLO UN CICLO.
 *     La única forma de cambiar de tema era `toggleTheme()`, que rotaba
 *     claro → oscuro → sistema. Para ir de claro a sistema había que pulsar dos
 *     veces y pasar por oscuro. Un control de tres estados debe permitir
 *     elegir el estado; el ciclo se conserva para el botón compacto.
 *
 *  4. FUENTE ÚNICA DE VERDAD.
 *     `BrandingService` mantenía su propio `uiMode` claro/oscuro en otra clave
 *     de `localStorage`. Dos servicios decidían el tema y el último en
 *     escribir ganaba — de ahí que la interfaz apareciese a veces con los dos
 *     temas mezclados. El tema lo gobierna ahora exclusivamente este servicio;
 *     el de marca delega en él.
 * =============================================================================
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly darkQuery: MediaQueryList | null = this.isBrowser
    ? this.document.defaultView?.matchMedia(DARK_QUERY) ?? null
    : null;

  /** Preferencia del sistema operativo, en vivo. */
  private readonly systemPrefersDark = signal(this.darkQuery?.matches ?? false);

  /** Preferencia elegida por el usuario. */
  readonly mode = signal<ThemeMode>(this.readStoredMode());

  readonly contrast = signal<ContrastMode>(this.readStoredContrast());

  /** Tema realmente aplicado, con `system` ya resuelto. */
  readonly appliedTheme = computed<AppliedTheme>(() => {
    const mode = this.mode();
    if (mode !== 'system') return mode;
    return this.systemPrefersDark() ? 'dark' : 'light';
  });

  readonly isDark = computed(() => this.appliedTheme() === 'dark');

  constructor() {
    //  `addEventListener` sobre MediaQueryList no necesita retirada explícita:
    //  el servicio vive en la raíz de la aplicación, así que su ciclo de vida
    //  es el del documento. La implementación anterior tenía un `ngOnDestroy`
    //  que en la práctica no llegaba a ejecutarse nunca.
    this.darkQuery?.addEventListener('change', (event) =>
      this.systemPrefersDark.set(event.matches)
    );

    effect(() => this.syncDocument(this.mode(), this.contrast()));
  }

  /** Fija una preferencia concreta. */
  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    this.persist(THEME_STORAGE_KEY, mode);
  }

  /** Rota claro → oscuro → sistema. Para el botón compacto de la barra. */
  toggleMode(): void {
    const next: Record<ThemeMode, ThemeMode> = {
      light: 'dark',
      dark: 'system',
      system: 'light',
    };
    this.setMode(next[this.mode()]);
  }

  setContrast(contrast: ContrastMode): void {
    this.contrast.set(contrast);
    this.persist(CONTRAST_STORAGE_KEY, contrast);
  }

  /* ── Interno ─────────────────────────────────────────────────────────────── */

  /**
   * Refleja el estado en el `<html>`. Es el único punto del sistema que
   * escribe atributos de tema en el DOM.
   */
  private syncDocument(mode: ThemeMode, contrast: ContrastMode): void {
    if (!this.isBrowser) return;

    const root = this.document.documentElement;

    //  En modo `system` se RETIRA el atributo para que gobierne
    //  `prefers-color-scheme` desde el propio CSS.
    if (mode === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', mode);
    }

    if (contrast === 'high') {
      root.setAttribute('data-contrast', 'high');
    } else {
      root.removeAttribute('data-contrast');
    }

    //  Mantiene alineada la etiqueta que colorea la barra del navegador en
    //  móvil. Sin esto, la barra del sistema conserva el color del tema
    //  anterior y el conjunto se ve partido.
    this.syncThemeColorMeta();
  }

  private syncThemeColorMeta(): void {
    const view = this.document.defaultView;
    if (!view) return;

    //  Se lee el token ya resuelto en lugar de codificar el color aquí: así
    //  este servicio nunca necesita conocer la paleta.
    const surface = view
      .getComputedStyle(this.document.documentElement)
      .getPropertyValue('--surface-canvas')
      .trim();

    if (!surface) return;

    let meta = this.document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = this.document.createElement('meta');
      meta.name = 'theme-color';
      this.document.head.appendChild(meta);
    }
    meta.content = surface;
  }

  private readStoredMode(): ThemeMode {
    const stored = this.readStorage(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system'
      ? stored
      : 'system';
  }

  private readStoredContrast(): ContrastMode {
    return this.readStorage(CONTRAST_STORAGE_KEY) === 'high' ? 'high' : 'normal';
  }

  /**
   * El acceso a `localStorage` va envuelto: en modo incógnito de Safari y con
   * las cookies de terceros bloqueadas, LEER ya lanza una excepción. Sin esta
   * protección la aplicación entera no arrancaba para esos usuarios.
   */
  private readStorage(key: string): string | null {
    if (!this.isBrowser) return null;
    try {
      return this.document.defaultView?.localStorage.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private persist(key: string, value: string): void {
    if (!this.isBrowser) return;
    try {
      this.document.defaultView?.localStorage.setItem(key, value);
    } catch {
      /* Almacenamiento no disponible: la preferencia solo dura la sesión. */
    }
  }
}
