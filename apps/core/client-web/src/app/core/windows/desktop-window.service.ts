import { Injectable, computed, signal } from '@angular/core';

/**
 * El puente que el preload de Electron expone en `window.virtexDesktop`.
 *
 * Se declara aquí y no como tipo global porque es el único punto del cliente
 * que necesita conocer su forma completa: el resto del código solo pregunta
 * «¿soy el escritorio?» a través de este servicio. En el navegador el puente no
 * existe y todos los campos quedan indefinidos.
 */
interface DesktopWindowControls {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  /** Se suscribe a los cambios de maximizado y devuelve la baja de la escucha. */
  onMaximized(callback: (state: boolean) => void): () => void;
}

interface VirtexDesktopBridge {
  isDesktop?: boolean;
  platform?: string;
  windowControls?: DesktopWindowControls;
}

/**
 * Convierte el topbar del cliente web en la barra de título de la ventana de
 * Electron.
 *
 * ## Por qué un servicio y no `process.platform` a secas
 *
 * El mismo cliente web se sirve en el navegador y dentro del escritorio. En el
 * navegador no hay puente, así que todo lo de aquí queda inerte: `isDesktop()`
 * es falso, no se pinta ningún control y la barra no arrastra nada. Concentrar
 * esa distinción en un sitio evita sembrar comprobaciones de `virtexDesktop` por
 * la plantilla.
 *
 * ## Semáforos en macOS, botones en Windows
 *
 * En macOS los controles de ventana los dibuja el sistema (los semáforos), así
 * que el topbar solo reserva su hueco a la izquierda. En Windows y Linux la
 * ventana no tiene marco y es el topbar quien dibuja minimizar, maximizar y
 * cerrar a la derecha; de ahí `showsWindowControls`.
 */
@Injectable({ providedIn: 'root' })
export class DesktopWindowService {
  private readonly bridge = (globalThis as { virtexDesktop?: VirtexDesktopBridge })
    .virtexDesktop;

  private readonly controls = this.bridge?.windowControls;

  /** Verdadero solo dentro del escritorio y con el puente de ventana disponible. */
  readonly isDesktop = signal(Boolean(this.bridge?.isDesktop && this.controls));

  /** `darwin`, `win32`, `linux`… tal cual lo reporta el proceso principal. */
  readonly platform = signal(this.bridge?.platform ?? '');

  /** Si la ventana está maximizada ahora mismo. Mueve el icono maximizar/restaurar. */
  readonly isMaximized = signal(false);

  readonly isMac = computed(() => this.isDesktop() && this.platform() === 'darwin');

  readonly isWindows = computed(() => this.isDesktop() && this.platform() === 'win32');

  /**
   * Si el topbar debe dibujar sus propios botones de ventana. En macOS no: los
   * pone el sistema (los semáforos), y duplicarlos sería la segunda barra que
   * precisamente se quiere evitar.
   */
  readonly showsWindowControls = computed(() => this.isDesktop() && !this.isMac());

  constructor() {
    if (!this.controls) return;

    //  El estado inicial llega por promesa; los cambios, por suscripción. La app
    //  es zoneless, así que fijar la señal desde estas devoluciones asíncronas ya
    //  agenda la detección de cambios sin necesitar la zona.
    this.controls
      .isMaximized()
      .then((state) => this.isMaximized.set(state))
      .catch(() => undefined);
    this.controls.onMaximized((state) => this.isMaximized.set(state));
  }

  minimize(): void {
    this.controls?.minimize();
  }

  toggleMaximize(): void {
    this.controls?.toggleMaximize();
  }

  close(): void {
    this.controls?.close();
  }
}
