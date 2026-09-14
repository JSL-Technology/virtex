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
  /**
   * Los datos estáticos que el manifiesto entrega a la ventana, p. ej. `{ side: 'payables' }`.
   *
   * El manifiesto los declaraba y nada los leía. La página de antigüedad de saldos pregunta
   * `ActivatedRoute.snapshot.data['side']` y, a falta de valor, asume `'receivables'`: la ventana
   * de cuentas por PAGAR mostraba lo que deben los CLIENTES bajo una cabecera «Proveedor», y el
   * saldo con proveedores no era alcanzable desde ningún sitio del producto.
   */
  data: Record<string, unknown>;

  /**
   * Renombra ESTA pestaña con el nombre real del documento.
   *
   * Una pestaña se abre antes de que exista el registro que va a mostrar, así que su título sale
   * de los parámetros de la ruta: para `/invoices/:id` eso es un UUID. Las pestañas de factura, de
   * factura de proveedor y de asiento se titulaban con él —«Asiento 7c1f…»— y con doce abiertas el
   * usuario tenía doce títulos truncados que no distinguían nada.
   *
   * La página llama a esto en cuanto conoce el número del documento. Texto ya resuelto, no una
   * clave: quien lo llama tiene el número, y el número no se traduce.
   */
  setTitle(title: string): void;

  /**
   * Esta ventana pasa a mostrar OTRA ruta, sin abrir una segunda.
   *
   * Existe para un momento concreto: el borrador que acaba de guardarse y ya no es un borrador.
   * `/hcm/employees/new` se convierte en `/hcm/employees/<id>/edit` —con su título, su icono y su
   * clave de entidad— en el mismo sitio, y la barra de direcciones sigue a la ventana. Sin esto la
   * URL se quedaba en `new` después de guardar, y recargarla devolvía un formulario vacío que
   * invitaba a guardar el mismo registro por segunda vez.
   *
   * No es `router.navigate`: navegar dejaría el borrador abierto y pondría el registro en una
   * ventana nueva al lado.
   */
  replaceRoute(route: string, options?: { title?: string }): void;

  /**
   * Cierra ESTA ventana, sin preguntar.
   *
   * Para el borrador que ya cumplió: se guardó y la página se fue a la lista. Sin esto la ventana
   * «Nueva factura» se quedaba abierta con la factura ya emitida dentro y su clave de borrador
   * puesta, así que el siguiente «Nueva factura» la enfocaba y enseñaba el documento anterior en
   * vez de un formulario en blanco.
   *
   * No pregunta por cambios sin guardar —a diferencia de cerrar con la X— porque quien llama acaba
   * de guardarlos. Tampoco entra en la pila de «reabrir pestaña cerrada»: reabrir un borrador
   * terminado devolvería un formulario vacío, que no es lo que nadie espera de esa acción.
   */
  close(): void;

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
