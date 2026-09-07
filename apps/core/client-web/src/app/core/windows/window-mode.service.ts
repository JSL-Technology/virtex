import { Injectable, computed, signal } from '@angular/core';

/**
 * Cómo se disponen las ventanas internas del área de trabajo.
 *
 * Tres modos y no una casilla de «modo avanzado», porque describen tres maneras distintas de
 * trabajar y no un grado de dificultad:
 *
 *  - `focused`  — una ventana a la vista, las demás en pestañas. Es lo que quiere quien hace una
 *                 cosa detrás de otra: facturar veinte documentos, revisar un extracto.
 *  - `workshop` — el taller. Varias ventanas a la vez: dividir, mosaico y flotantes. Es lo que hace
 *                 falta para conciliar, cuadrar un cierre o comparar dos periodos, donde la tarea
 *                 ES mirar dos cosas juntas.
 *  - `compact`  — pantalla estrecha. Una ventana, sin franja de pestañas, sin divisiones.
 *
 * ## Por qué el modo compacto no se elige
 *
 * Porque no es una preferencia: en 600 px de ancho no caben dos ventanas, y ofrecer que se dividan
 * sería ofrecer algo que no funciona. Se impone por el tamaño de la ventana y se recuerda cuál
 * había elegido el usuario para devolvérselo cuando el espacio vuelve.
 */
export type WindowMode = 'focused' | 'workshop' | 'compact';

/** Debajo de esto, el taller no cabe. Coincide con el punto en el que el panel pasa a cajón. */
const COMPACT_BREAKPOINT = 768;

const STORAGE_KEY = 'virtex.windowMode';

@Injectable({ providedIn: 'root' })
export class WindowModeService {
  /** Lo que el usuario eligió. Se conserva aunque el modo efectivo sea compacto. */
  private readonly preferred = signal<Exclude<WindowMode, 'compact'>>(restore());

  private readonly narrow = signal(isNarrow());

  /**
   * El modo que rige ahora.
   *
   * Derivado y no almacenado: el ancho de la ventana cambia sin que nadie pulse nada, y guardar
   * «compacto» como elección haría que el usuario volviera a un escritorio con el modo equivocado.
   */
  readonly mode = computed<WindowMode>(() => (this.narrow() ? 'compact' : this.preferred()));

  /** Si se pueden abrir varias ventanas a la vez. Lo consultan el host y sus menús. */
  readonly canTile = computed(() => this.mode() === 'workshop');

  /** Si hay franja de pestañas. En compacto no la hay: ocupa una fila que no sobra. */
  readonly showsTabs = computed(() => this.mode() !== 'compact');

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.narrow.set(isNarrow()), { passive: true });
    }
  }

  /**
   * Guardar aquí y no en un `effect`: persistir es consecuencia de que alguien elija, no de que
   * alguien lea la señal. Con un efecto, además, la preferencia solo se escribía cuando corría la
   * detección de cambios, así que elegir el taller y recargar devolvía el modo enfocado.
   */
  set(mode: Exclude<WindowMode, 'compact'>): void {
    this.preferred.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      //  Modo privado o almacenamiento bloqueado: se pierde la preferencia entre sesiones y no
      //  pasa nada más. No es motivo para romper el área de trabajo.
    }
  }

  toggle(): void {
    this.set(this.preferred() === 'workshop' ? 'focused' : 'workshop');
  }
}

function isNarrow(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < COMPACT_BREAKPOINT;
}

function restore(): Exclude<WindowMode, 'compact'> {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'workshop' ? 'workshop' : 'focused';
  } catch {
    return 'focused';
  }
}
