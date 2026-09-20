/**
 * La vida de un documento, declarada.
 *
 * ## Qué problema resuelve y cuál NO
 *
 * Hoy el producto tiene exactamente dos máquinas de estado escritas —requisición y orden de
 * compra— y las dos viven como una constante dentro del servicio que las usa. Todo lo demás
 * —factura, asiento, factura de proveedor, nómina— cambia de estado en el cuerpo de los métodos,
 * repartido. Eso tiene dos consecuencias: nadie puede decir desde fuera qué le puede pasar a un
 * documento, y la interfaz no puede mostrarlo sin volver a escribir las reglas por su cuenta,
 * que es como se acaban teniendo dos versiones de la verdad.
 *
 * Esto declara el ciclo de vida en un sitio y deja que lo lean los dos: el servicio, para
 * decidir si una transición es legal, y la pantalla, para enseñar dónde está el documento y qué
 * viene después.
 *
 * ## Por qué vive en la librería compartida y no en el servidor
 *
 * Porque las dos mitades no solo leen la misma tabla: la RECORREN igual. Si `mainPath` se
 * escribe dos veces, la tira de etapas que dibuja el navegador puede diferir del camino que el
 * servidor considera normal, y volvemos exactamente al problema que esto viene a quitar, un
 * piso más arriba. Aquí la función es una, y la declaración de cada documento viaja por HTTP.
 *
 * **Lo que esto NO es** es «el proceso como lente». Esa vista —compra-a-pago de punta a punta,
 * atravesando requisición, orden, recepción, factura y pago— necesita que el producto declare
 * cómo se encadenan esos documentos ENTRE SÍ, y eso no existe en ninguna parte: no es algo que
 * se pueda deducir del código, es una decisión sobre cómo trabaja el negocio. Declarar la vida de
 * cada documento es el escalón que esa vista necesita debajo, y vale por sí solo.
 */

/** Una etapa por la que pasa un documento. */
export interface LifecycleStage<TStatus extends string = string> {
  status: TStatus;
  /** Clave de traducción. El ciclo de vida no decide en qué idioma se lee. */
  labelKey: string;
  /**
   * A qué otras etapas puede ir desde aquí. Vacío significa final: no es un olvido, es el final.
   */
  next: TStatus[];
  /**
   * Una etapa a la que se llega cuando algo sale mal —rechazada, anulada— y que por eso no va en
   * la línea principal aunque sea alcanzable. Se dibuja aparte para que la línea siga leyéndose
   * como lo que se espera que pase.
   */
  exceptional?: boolean;
}

export interface DocumentLifecycle<TStatus extends string = string> {
  /** El tipo de documento, como lo nombra la ruta: `purchase-order`, `requisition`. */
  documentType: string;
  /** Clave de traducción del nombre del documento. */
  labelKey: string;
  stages: Array<LifecycleStage<TStatus>>;
}

/** ¿Es legal ir de `from` a `to` en este ciclo de vida? */
export function canTransition<T extends string>(
  lifecycle: DocumentLifecycle<T>,
  from: T,
  to: T,
): boolean {
  return lifecycle.stages.find((s) => s.status === from)?.next.includes(to) ?? false;
}

/**
 * La línea principal: de la primera etapa a un final, siguiendo siempre el primer `next`.
 *
 * Es lo que se dibuja como recorrido esperado. Las etapas excepcionales quedan fuera a propósito:
 * una línea que incluye «rechazada» entre «aprobada» y «recibida» sugiere que rechazar es un paso
 * del camino, y no lo es.
 */
export function mainPath<T extends string>(lifecycle: DocumentLifecycle<T>): T[] {
  const porEstado = new Map(lifecycle.stages.map((s) => [s.status, s]));
  const camino: T[] = [];
  let actual: T | undefined = lifecycle.stages[0]?.status;

  while (actual && !camino.includes(actual)) {
    camino.push(actual);
    const siguiente: T | undefined = porEstado
      .get(actual)
      ?.next.find((n) => !porEstado.get(n)?.exceptional);
    actual = siguiente;
  }
  return camino;
}
