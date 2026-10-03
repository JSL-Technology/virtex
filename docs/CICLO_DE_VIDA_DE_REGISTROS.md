# Ciclo de vida de los registros: qué se puede borrar, y qué se corrige de otra forma

Auditoría de todas las acciones destructivas o de cambio de estado del producto, contrastadas con
lo que hacen los ERP de referencia (SAP Business One, Microsoft Dynamics 365 Business Central,
Oracle NetSuite, Odoo, QuickBooks/Xero). Cada decisión está justificada y aplicada en código, con
la prueba que la sostiene.

## La regla, en una frase

> **Lo que nada usa se elimina. Lo que algo usa se desactiva, se cierra o se archiva. Lo que llegó
> a los libros se anula o se revierte — nunca se edita ni se borra.**

Es la regla de todos los ERP serios, y no por costumbre: un documento fiscal o contable es un
registro legal (el Código Tributario dominicano, art. 50, exige conservar los soportes diez años;
NIIF y cualquier auditoría exigen trazabilidad), y el dato maestro que esos documentos nombran
(cliente, producto, proveedor, cuenta, empleado) no puede desaparecer debajo de ellos.

## Tres familias de registros

| Familia | Ejemplos | Qué se permite | Por qué |
|---|---|---|---|
| **Documentos contabilizados** | Facturas, notas de crédito y débito, facturas de proveedor, asientos, cobros, pagos, nóminas pagadas | Anular / revertir con motivo, fecha y autor. Solo el **borrador** se descarta. | El asiento ya está en el mayor y el documento ya se reportó (606/607, e-CF, TSS). Borrarlo deja el mayor apuntando a nada; editarlo hace que el mayor y el documento digan cosas distintas. |
| **Datos maestros** | Clientes, proveedores, productos, almacenes, proyectos, centros de costo, dimensiones, conceptos de nómina, empleados, cuentas | Eliminar **solo si nada los usa**. Si algo los usa: desactivar, cerrar, archivar o terminar. | Los documentos los nombran. La negativa dice *qué* lo usa y *cuántos*, y ofrece la alternativa. |
| **Configuración sin historia** | Reglas de conciliación, plantillas, políticas de aprobación, recurrentes | Eliminar libremente. | No hay nada que los nombre. |

## Decisión por acción

| Acción | Antes | Ahora | Referencia de industria |
|---|---|---|---|
| Eliminar cliente / proveedor / producto con documentos | Cascada a facturas emitidas (C-03) | Rechazo con detalle; desactivar | Todos: "no se puede eliminar, tiene transacciones" |
| Eliminar departamento con empleados | Huérfanos | Rechazo con detalle | SAP HCM, Workday |
| Eliminar **almacén** con ubicaciones o existencias | `delete` directo | Rechazo; desactivar | SAP B1: almacén con existencias no se borra |
| Eliminar **proyecto** / tarea con horas | `delete` directo | Rechazo; cerrar el proyecto | NetSuite, D365 Project Operations |
| Eliminar **lista de materiales** usada por órdenes | `delete` directo | Rechazo; crear versión nueva | SAP PP, D365: versiones de BOM |
| Eliminar **orden de producción** | Cualquiera | Solo planificada, o cancelada sin producción; si no, cancelar | Todos los MRP |
| Eliminar **activo fijo** depreciado | `delete` directo: el mayor conservaba costo y depreciación de un activo que ya no existía | Solo si nunca se depreció; si no, baja o venta | SAP "retiro de activo", Odoo: solo borradores |
| Renombrar / eliminar **dimensión analítica** usada | Permitido: la historia perdía su clasificación | Inmutable una vez usada; valores nuevos sí | D365 BC: el código de dimensión es inmutable tras usarse |
| Eliminar **concepto de nómina** usado | Permitido (salvo de sistema) | Rechazo; desactivar | Todos los sistemas de nómina |
| Eliminar **empleado** con nómina sin terminarlo | Borrado lógico de un empleado activo: nunca constaba su salida (TSS) | Primero terminar (fecha y motivo), luego archivar | Workday, SAP HCM: terminación ≠ eliminación |
| Editar **nota de débito** contabilizada | Cambiaba el importe; asiento y saldo quedaban con el anterior | Inmutable | Todos |
| Eliminar **nota de débito** | Borraba la nota; su asiento quedaba en el mayor | Rechazo; anular | Todos |
| Anular **nota de débito** | No implementado (lanzaba error) | Reversa del asiento, restitución del saldo, motivo/fecha/autor | Todos |
| Eliminar **adjunto** de un asiento contabilizado | Permitido; además borraba el archivo antes que la fila | Evidencia de solo-agregar; orden corregido | SOX, Código Tributario art. 50 |
| Eliminar factura de proveedor | Ya rechazado (usar anulación) | Sin cambio | — |
| Eliminar orden de compra / requisición | Ya solo en borrador | Sin cambio | — |
| Eliminar categoría de producto | Ya rechazado si tiene productos o subcategorías | Sin cambio | — |
| Eliminar rol asignado | Ya rechazado | Sin cambio | — |
| Eliminar usuario | Revoca la membresía; la identidad sobrevive si pertenece a otra empresa | Sin cambio (correcto) | — |
| Eliminar documento del repositorio | Permitido | Sin cambio: es una biblioteca de archivos, no evidencia contable | — |
| **Eliminar la empresa (tenant)** | Fallaba por orden de cascada, o dejaba 43 tablas huérfanas con datos personales | Borrado completo y comprobado | LGPD, normas de privacidad, baja de clientes |

## Cómo se garantiza (defensa en profundidad)

1. **El servicio** comprueba primero y explica: `assertNotInUse()` (`common/database/dependents.ts`)
   lee las claves foráneas del propio esquema. `CASCADE` es composición (las líneas de un
   documento) y no bloquea; `SET NULL` declara una referencia que puede limpiarse y no bloquea;
   `NO ACTION`/`RESTRICT` es *uso* y bloquea, nombrando la tabla. Una tabla nueva que apunte a un
   almacén queda cubierta sin tocar el servicio.
2. **La base de datos** lo impide aunque un servicio lo olvide: esas referencias son
   `NO ACTION DEFERRABLE INITIALLY DEFERRED`. Se comprueban al hacer COMMIT, así que eliminar un
   cliente con facturas falla, pero eliminar la empresa entera — que borra ambos lados en una sola
   sentencia — funciona sin depender del orden en que PostgreSQL recorre la cascada.
3. **El cliente** muestra el motivo real: la API responde `{ code, messageKey, params }` (sin
   `message`). Veinte pantallas leían `error.message`, que nunca existió, y siempre mostraban un
   genérico. Ahora todas pasan por `NotificationService.showHttpError`.

## Borrado de la empresa (tenant)

Toda tabla con `organization_id` declara `@TenantOwned()` (contrato público del módulo de
organizaciones): `organization_id → organizations ON DELETE CASCADE`. Se encontraron 43 tablas sin
esa restricción —empleados, nóminas, recibos de nómina, leads, casos, proyectos, adjuntos—, 19 de
ellas con el identificador guardado como texto (lo que además impedía usar el índice en cada
consulta filtrada por RLS). Excepciones documentadas: `audit_logs` (retención propia) y `users`
(identidad que puede pertenecer a varias empresas; se limpia el puntero).

## Pruebas que lo sostienen

- `database/tenant-deletion.spec.ts`: borra una empresa con libros, compras, recepciones,
  existencias y empleados; comprueba que cada borrado protegido se rechaza **al commit**
  (`SET CONSTRAINTS ALL IMMEDIATE`, porque la prueba revierte); y falla si una tabla nueva de
  empresa no tiene la restricción.
- `common/database/record-lifecycle.spec.ts`: proyectos, almacenes, conceptos, órdenes de
  producción, activos fijos y dimensiones.
- `accounts-payable/accounts-payable.spec.ts` › *debit notes*: emisión, liquidación, inmutabilidad
  y anulación con reversa.
