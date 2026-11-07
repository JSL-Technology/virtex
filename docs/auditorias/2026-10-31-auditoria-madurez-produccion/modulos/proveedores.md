# M17 — Proveedores (`suppliers`)

> Sin hallazgos críticos de seguridad. IDOR desde qa-b → 404 en GET y PATCH de un proveedor de qa-a.
> **El riesgo de "fraude por cambio de cuenta bancaria" no aplica porque el proveedor NO tiene datos bancarios**: no se pueden cifrar ni auditar porque no existen. Es una capacidad básica ausente.

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/suppliers/` (10 archivos, ~690 LOC, 1 spec).
- **Endpoints:** `suppliers` (CRUD, búsqueda, dependientes) más `suppliers/:id/statement` (en CxP).
- **Entidad:** `suppliers` con nombre, contacto, email, teléfono, `taxId`, tipo y país del documento, dirección, país y `taxpayerType`.
- **Frontend:** `features/contacts/suppliers` (1 ts + 1 spec).
- **Dependencias:** `IdentityDocumentService` (localización) y `SaasService` (límite de plan).

## 2. Estándar de referencia
- **Básico:** identificación fiscal validada por país y única por tenant; condiciones de pago; moneda; cuentas contables por defecto; datos bancarios; bloqueo e inactivación; retenciones/tipo de contribuyente; contactos.
- **Avanzado:** onboarding con verificación (W-9/1099 en US, RUT en CO), validación del cambio de cuenta bancaria con doble control y notificación, scoring, documentos y vencimientos.
- **Invariantes:** un proveedor por identificación fiscal; cambios de datos sensibles (banco, NIT, tipo de contribuyente) auditados con autor y antes/después.
- **Referencias:** NetSuite, BC, Bill.com (verificación bancaria). Confianza media.

## 3. Resultado
**Madurez 45** (38–52, media) · **Preparación 42 — No listo** (falta capacidad básica) · eje más débil: Completitud · críticos: 0 · altos: 3.

## 4. Ejes
| # | Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|---|
| 1 | Completitud | 42 (35–50, alta) | Sin banco, términos, moneda, cuentas por defecto ni estado activo/bloqueado (`entities/supplier.entity.ts`). | Añadirlos. |
| 2 | Integridad | 50 (40–58, media) | Sin unicidad de `taxId`; solo `findByTaxId`, que toma el primero, y `suppliers-duplicates.source.ts` para IA. Borrado protegido por dependientes. | Índice único normalizado. |
| 3 | Multi-país | 60 (50–68, media) | Validación por país: la cédula DO con dígito verificador se aceptó; un NIT CO sin tipo se rechazó (422) y con `identityDocumentTypeCode: NIT` se aceptó. | 1099/W-9 US, RUT CO, catálogo de responsabilidades. |
| 4 | Arquitectura | 62 | Servicio pequeño y claro. | — |
| 5 | Higiene | 60 | Compras y CxP importan la entidad directamente. | Contrato de lectura. |
| 6 | Calidad de código | 65 | — | — |
| 7 | Robustez | 50 | `findAll` sin límite si no se pasa `limit`. | Paginación obligatoria. |
| 8 | Seguridad | 68 (60–75, media) | IDOR → 404; permisos por endpoint (no se leyó el controlador al completo). | Prueba de rol restringido. |
| 9 | Pruebas | 30 | 1 spec (búsqueda). | Validación, unicidad. |
| 10 | Operabilidad | 50 | `suppliers` está en `AUDITED_TABLES`, pero sin autor (AUD-01). | Autor y diff. |
| 11 | UX | 50 (baja) | 1 componente; no probado. | — |
| 12 | Competitividad | 35 | — | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Capacidades básicas | **No cumple** | Sin datos bancarios ni términos. |
| 2 | Integridad | No cumple | Sin unicidad fiscal. |
| 3 | Aislamiento | Cumple | IDOR → 404. |
| 4 | Validación en servidor | Cumple | Documento de identidad por país. |
| 5 | E2E | Cumple (API) | — |
| 6 | Cumplimiento por país | Parcial | Validación DO y CO OK; resto no probado. |
| 7 | CI | No verificado | — |
| 8 | Auditoría | Parcial | AUD-01. |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Parcial | — |
| 11 | UI | No verificado | — |
| 12 | Documentación | Parcial | — |

## 6. Hallazgos
**SUP-01** — eje 1 · Funcionalidad · **Alta**
- **Qué pasa:** el proveedor no tiene datos bancarios. Búsqueda de `bank|iban|routing|accountNumber` en `suppliers/`, `procurement/` y `accounts-payable/entities`: solo aparece `payment_batches.bank_account_id`, que es la cuenta del pagador.
- **Consecuencias:** no hay archivos de pago ni transferencias al proveedor. El control antifraude de cambio de cuenta (doble aprobación, notificación, auditoría) no existe.
- **Forma correcta:** tabla de cuentas bancarias del proveedor, cifrada, con verificación y aprobación de cambios.
- **Esfuerzo:** M.

**SUP-02** — eje 2 · Integridad · **Alta**
- **Qué pasa:** se puede crear el mismo `taxId` más de una vez. No hay índice único; `create` no comprueba (`suppliers.service.ts` `create`). Combinado con la deduplicación de NCF por `vendor_id` en CxP, un proveedor duplicado elude la detección de facturas duplicadas. Estático; no se ejecutó la creación duplicada.
- **Esfuerzo:** S.

**SUP-03** — eje 1 · **Alta**
- **Qué pasa:** no hay condiciones de pago ni moneda por defecto, cuentas contables por defecto ni estado activo/bloqueado. Por eso no se puede impedir pagar o comprar a un proveedor bloqueado.
- **Esfuerzo:** M.

**SUP-04** — eje 10 · **Media**
- **Qué pasa:** cambiar `taxpayerType` altera las retenciones de CxP (`purchaseRegimesFor`) sin aprobación; la auditoría no registra autor (AUD-01).
- **Esfuerzo:** S.

**SUP-05** — eje 7 · **Media**. Listado sin paginación por defecto.

## 7. Camino mínimo a producción
1. SUP-02 (S)
2. SUP-03 (M)
3. SUP-01 con control de cambio de cuenta (M)
4. Autor en la auditoría (transversal)

## 8. Camino a 100
| Mejora | Puntos | Esfuerzo |
|---|---|---|
| Banco cifrado con doble control | +15 | M |
| Términos y cuentas por defecto | +10 | M |
| Unicidad fiscal | +6 | S |
| Onboarding y documentos (W-9, RUT) | +8 | L |
| Pruebas | +5 | S |

## 9. Competitividad (35)
Por debajo de QuickBooks, Bill.com, Alegra y Siigo, que guardan banco, términos y retenciones por proveedor. Su diferenciador es la validación fiscal por país, que está bien hecha.

## 10. Fortalezas
- Validación de identificación por país mediante `IdentityDocumentService`.
- Borrado protegido por dependientes.
- Límite de plan aplicado dentro de la transacción.

## 11. No verificado
- Creación duplicada ejecutada.
- UI.
- Importación masiva (`suppliers-data-transfer.provider.ts`).
- Permisos del controlador por rol.

Cobertura: ~70 % de los archivos y 4 endpoints.

<!-- RESUMEN: modulo=proveedores; madurez=45; prep=42; veredicto=No listo; eje_debil=Completitud; criticos=0; altos=3; camino_min=M -->
