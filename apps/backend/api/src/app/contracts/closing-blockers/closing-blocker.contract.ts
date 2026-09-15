/**
 * Lo que impide cerrar un período contable, preguntado sin saber a quién se le pregunta.
 *
 * ## El ciclo que esto elimina
 *
 * `ClosingChecklistService` (Contabilidad) contaba facturas de proveedor sin aprobar y
 * transacciones bancarias sin conciliar importando `VendorBill` de Compras y `BankTransaction` de
 * Finanzas. Eran dos líneas de import, y entre las dos creaban `compras ↔ contabilidad` y
 * `contabilidad ↔ finanzas`: ninguno de los tres módulos se podía extraer sin los otros dos, por
 * una pregunta que Contabilidad no necesitaba hacerse a sí misma.
 *
 * El checklist no quiere las filas. Quiere saber si queda algo pendiente y cuánto. Eso es una
 * pregunta, no una entidad.
 *
 * ## La dirección de la dependencia
 *
 * El contrato vive en `plataforma`, que no depende de ningún módulo de negocio. Contabilidad
 * pregunta contra él; Compras, Finanzas y quien venga después responden contra él. Ni el que
 * pregunta conoce a los que responden ni al revés, que es lo que permite extraer cualquiera de
 * ellos sin tocar a los demás: un módulo que se va deja de registrarse y el checklist pierde sus
 * líneas, sin un solo import roto.
 */

/**
 * El período por el que se pregunta. Fechas ISO (`YYYY-MM-DD`), nunca `Date`: las columnas de fecha
 * de documento son `date` en todos los módulos, y convertir aquí una sola vez evita que cada
 * proveedor repita la conversión y alguno la haga distinta.
 *
 * `periodId` es opaco a propósito. Los proveedores lo usan para componer el enlace de resolución y
 * nada más; no deben consultarlo contra ninguna tabla de Contabilidad, que sería volver a abrir el
 * acoplamiento que este contrato cierra.
 */
export interface ClosingPeriodQuery {
  readonly organizationId: string;
  readonly periodId: string;
  /** Primer día del período, inclusive. */
  readonly startDate: string;
  /** Último día del período, inclusive. */
  readonly endDate: string;
}

/**
 * Una línea del checklist de cierre.
 *
 * `descriptionKey` y `noteKey` son claves de catálogo, no frases: el cierre lo hace quien lo hace,
 * y en un grupo con subsidiarias rara vez es la misma persona dos veces.
 */
export interface ClosingBlocker {
  /** Identificador estable de la comprobación. No se muestra nunca. */
  readonly id: string;
  readonly descriptionKey: string;
  /** Valores de interpolación para `descriptionKey` — cuentas, nunca prosa. */
  readonly params?: Record<string, unknown>;
  readonly isCompleted: boolean;
  /** Por qué no se puede decidir automáticamente, donde sea el caso. */
  readonly noteKey?: string;
  /** Cifras que respaldan la comprobación, para que el cliente las muestre junto a la descripción. */
  readonly details?: Record<string, number>;
  readonly resolutionLink?: string;
}

/**
 * Lo que implementa un módulo capaz de impedir un cierre.
 *
 * Debe ser **solo lectura** y no lanzar: el checklist es un diagnóstico, y un proveedor caído tiene
 * que degradar su propia línea, no tumbar la pantalla de cierre. El registro se encarga de eso.
 */
export interface ClosingBlockerProvider {
  /** Nombre del módulo que responde, para el diagnóstico cuando uno falla. */
  readonly providerName: string;
  blockersFor(period: ClosingPeriodQuery): Promise<readonly ClosingBlocker[]>;
}
