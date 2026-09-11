import { InjectionToken } from '@angular/core';
import { TabType } from './tab.model';
import type { TabSaveHandler } from './tab-state.service';
import type { TabBusEvent } from './tab-event-bus.service';

/**
 * Datos y acciones de la pestaña que hospeda al componente. Se provee por
 * inyección a través del injector del `TabWrapper`, de modo que cualquier página
 * pueda conocer su identidad y participar en el ciclo de vida del área de trabajo
 * SIN acoplarse al `TabStateService` ni al `TabEventBusService`.
 *
 * ## Por qué el contexto trae acciones y no solo datos
 *
 * El modelo de pestaña promete «cambios sin guardar», «guardar antes de cerrar» y
 * «cerrar la pestaña de un registro borrado en otra parte». Nada de eso funciona
 * si las páginas no tienen una forma discreta de decir «estoy sucio», «ya guardé»
 * o «este registro se borró». El contexto acerca esas API —ya ligadas a ESTA
 * pestaña— para que integrarse cueste una línea y no un servicio inyectado más un
 * `tabId` que pasear a mano.
 */
export interface TabContext {
  tabId: string;
  type: TabType;
  route: string;
  title: string;
  icon: string;
  params: Record<string, string>;
  query: Record<string, string>;

  /** Marca (o limpia) la pestaña como «con cambios sin guardar». */
  markDirty(isDirty?: boolean): void;
  /** Equivale a `markDirty(false)`: los cambios se guardaron o se descartaron. */
  markClean(): void;
  /**
   * Registra cómo guardar esta pestaña cuando el usuario elige «Guardar» en el
   * aviso de cierre. Debe devolver `true` si el guardado tuvo éxito (la pestaña se
   * cierra) o `false` para conservarla. Sin handler, el aviso no ofrece «Guardar».
   */
  registerSaveHandler(handler: TabSaveHandler): void;
  /** Publica un evento del área de trabajo (p. ej. RECORD_SAVED / RECORD_DELETED). */
  emit(event: TabBusEvent): void;
}

export const TAB_CONTEXT = new InjectionToken<TabContext>('TAB_CONTEXT');
