/**
 * Las colas del producto, en un sitio.
 *
 * ## Por qué una lista y no un registro al que cada módulo se apunte
 *
 * La bandeja por módulo usa un registro porque un módulo puede implementar el puerto sin que nadie
 * más se entere. Aquí no se puede: para leer una cola hace falta su instancia, y BullMQ la entrega
 * por un token que se construye con el NOMBRE en tiempo de compilación. Un registro obligaría a
 * cada módulo a declarar un proveedor solo para apuntarse, que es más ceremonia que la lista.
 *
 * Lo que hace que esta lista no se desvíe no es la disciplina de quien la escribe: es
 * `jobs-panel-coverage.spec.ts`, que lee los `@Processor(...)` del código y falla nombrando la cola
 * que falte. Una lista con guardia es honesta; una lista sin guardia es la deuda que este producto
 * ya pagó con el catálogo de ventanas.
 */
export const QUEUE_NAMES = [
  'account-jobs',
  'recurring-entries-processor',
  'intercompany-jobs',
  'mail',
  'ai-reports',
  'inbound-mail',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * Colas que NO se muestran en el panel, y por qué.
 *
 * El correo: enviar un mensaje ya compuesto no es trabajo del inquilino sobre sus propios datos,
 * no lleva `organizationId` en su carga —`queue-tenancy.spec.ts` lo exime por lo mismo— y un fallo
 * de envío se comunica por otros medios. Mostrarlo llenaría el panel de ruido que nadie puede
 * accionar.
 *
 * Los informes del asistente: cada uno es una fila de `ai_reports` con su propio estado (en cola,
 * en curso, listo, fallido y por qué), que su pantalla muestra y su aviso anuncia. El trabajo de la
 * cola es solo el medio; mostrarlo aquí también sería decir lo mismo dos veces.
 */
export const NOT_SHOWN: Partial<Record<QueueName, string>> = {
  mail: 'Envía un mensaje ya compuesto: no es trabajo del inquilino sobre sus datos.',
  'ai-reports': 'Cada informe lleva su estado en ai_reports, visible en su pantalla y anunciado por aviso.',
  'inbound-mail': 'Cada mensaje lleva su estado en inbound_messages, visible (con reintento) en la bandeja de su lista.',
};

/** Las colas que el panel muestra. */
export const VISIBLE_QUEUES = QUEUE_NAMES.filter((name) => !(name in NOT_SHOWN));
