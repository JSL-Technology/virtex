/**
 * Lo que un módulo tiene BLOQUEADO, contado por él mismo.
 *
 * ## Por qué un puerto y no una consulta central
 *
 * «Qué está pendiente en Contabilidad» solo lo sabe Contabilidad: un asiento en borrador, un
 * periodo que debió cerrarse, una conciliación a medias. Una consulta central tendría que conocer
 * las tablas de los diez módulos —justo lo que `verify:boundaries` existe para impedir— y se
 * quedaría atrás en cuanto uno cambiara su modelo.
 *
 * Con un puerto, la bandeja se DERIVA: el módulo que lo implementa aparece, el que no, no aparece.
 * Es la misma disciplina que el manifiesto de módulos en el cliente, donde la lista de páginas no
 * se mantiene a mano porque son las páginas.
 *
 * ## Por qué vive en plataforma
 *
 * `ALLOWED_DEPENDENCIES` dice que Reportes —dueño de la bandeja— solo puede depender de
 * plataforma, identidad y configuración. Si el puerto viviera en `my-work`, Contabilidad tendría
 * que importar Reportes para implementarlo y la flecha apuntaría al revés de como se extrae un
 * módulo. Con el puerto aquí, cada módulo se registra solo y la bandeja no conoce a ninguno.
 *
 * ## Por qué cuenta y además enumera
 *
 * El contador va al riel —el número que dice dónde hay trabajo sin entrar a mirar— y las primeras
 * entradas van a la bandeja. Dos consultas distintas darían dos respuestas distintas en el momento
 * en que una se cacheara y la otra no; una sola no puede desmentirse a sí misma.
 */

/** Una cosa concreta que espera a alguien. */
export interface InboxItem {
  /** El documento, no la fila de la bandeja: es lo que se abre al pulsar. */
  id: string;
  /** Clave de traducción con sus parámetros. La bandeja no decide en qué idioma se lee. */
  titleKey: string;
  titleParams?: Record<string, string | number>;
  /** Ruta del manifiesto, sin la empresa: el cliente le pone su prefijo. */
  route: string;
  /**
   * Desde cuándo espera. Es el orden de la bandeja: lo que lleva más tiempo bloqueado primero,
   * porque el coste de una cosa parada crece con lo que lleva parada.
   */
  blockedSince: string;
}

/** Lo que un módulo responde sobre su propio trabajo pendiente. */
export interface ModuleInbox {
  /** El mismo id que usa el manifiesto del cliente, para que el riel sepa a quién es el número. */
  moduleId: string;
  count: number;
  /** Las primeras entradas, ya ordenadas. La bandeja no paginará más allá de esto. */
  items: InboxItem[];
}

export abstract class ModuleInboxPort {
  /** El módulo del que habla este proveedor. */
  abstract readonly moduleId: string;

  /**
   * Qué está bloqueado en este módulo para esta empresa.
   *
   * `userId` llega porque algunas colas son personales —lo que espera MI aprobación— y otras son
   * de la empresa entera. Quien implementa decide cuál de las dos es la suya y lo dice en su
   * comentario, en vez de dejar al que lee la bandeja adivinando si el número es suyo.
   */
  abstract pending(organizationId: string, userId: string): Promise<ModuleInbox>;
}

/** Cuántas entradas trae cada módulo como mucho. Más que esto se ve en la lista del módulo. */
export const INBOX_ITEM_LIMIT = 5;
