import { Injectable, signal } from '@angular/core';
import { MenuContext, MenuSection } from './context-menu.types';

/**
 * El host real del menú (el componente `vx-context-menu`, montado una sola vez en `app.html`).
 * Se abstrae para que el servicio no dependa del componente y pueda testearse con un doble.
 */
export interface ContextMenuHost {
  openAt(x: number, y: number): void;
  close(): void;
}

/**
 * Abre el menú contextual en las coordenadas del cursor.
 *
 * El servicio no pinta nada: guarda las secciones y el contexto en señales que el host lee al
 * instanciarse en el overlay, y le pide abrir. Hay UN host para toda la app (el `MenuTracker` de
 * CDK cierra el menú anterior al abrir otro), así que cualquier directiva —filas, celdas, barra
 * lateral— abre por aquí sin montar su propio overlay.
 */
@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  private host: ContextMenuHost | null = null;
  readonly sections = signal<MenuSection[]>([]);
  readonly context = signal<MenuContext | null>(null);

  registerHost(host: ContextMenuHost): void {
    this.host = host;
  }

  open(event: MouseEvent | KeyboardEvent, sections: MenuSection[], context: MenuContext): void {
    if (!this.host || sections.length === 0) return;
    // Suprime el menú nativo del navegador; este lo sustituye.
    event.preventDefault();
    this.sections.set(sections);
    this.context.set(context);
    const { x, y } = coordsOf(event);
    this.host.openAt(x, y);
  }

  close(): void {
    this.host?.close();
  }
}

/** Dónde abrir: el cursor para el ratón; junto al elemento enfocado para el teclado (Shift+F10). */
function coordsOf(event: MouseEvent | KeyboardEvent): { x: number; y: number } {
  if (event instanceof MouseEvent && (event.clientX !== 0 || event.clientY !== 0)) {
    return { x: event.clientX, y: event.clientY };
  }
  const rect = (event.target as HTMLElement | null)?.getBoundingClientRect();
  return rect ? { x: rect.left + 8, y: rect.bottom - 4 } : { x: 0, y: 0 };
}
