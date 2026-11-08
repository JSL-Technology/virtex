# suppliers: maestro de proveedores (familia CMP)

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/suppliers/` (753 líneas). CRUD, `GET :id/dependents` y DELETE. También `suppliers/:id/statement`, que vive en accounts-payable. Proveedor de importación de datos, fuente de duplicados y herramientas copilot.
- **Tabla `suppliers`**: name, contactPerson, email, phone, taxId, address, country, taxpayer_type, identity_document_type_code/country. Única restricción CHECK: el par tipo/país del documento. Tiene FK a la organización y RLS forzada.
- **Frontend**: `features/contacts/suppliers` y `supplier-form`.
- **Pruebas**: `suppliers-search.spec.ts`. No hay spec de servicio con BD.
- **Países**: valida el documento con `IdentityDocumentService` según el país del proveedor o del inquilino.

## 2. Estándar de referencia
- (a) **Básicas**:
  - identificación fiscal única y validada;
  - condiciones de pago;
  - moneda;
  - cuentas bancarias del proveedor;
  - cuenta de gasto y CxP por defecto;
  - estado activo o bloqueado (bloqueo de pago);
  - contactos múltiples;
  - clasificación fiscal (para retenciones);
  - historial y auditoría.
- (a) **Avanzadas**: evaluación del proveedor, documentos y certificaciones, portal, verificación contra el registro tributario (DGII/SAT).
- (b) **Invariantes**:
  - un RNC/NIT por proveedor y por inquilino;
  - no se borra un proveedor con historia.
- (c) SAP BP, NetSuite Vendor, Odoo Partner y QuickBooks Vendor tienen términos, banco y 1099/tipo fiscal (confianza media, conocimiento general).

## 3. Resultado
- **Madurez: 40 (33–48, confianza media)**.
- **Preparación: 40 → No listo**: integridad del RNC rota (compuerta 2).
- **Eje más débil**: 1 y 2.
- **Críticos**: 0.

## 4. Ejes
| # | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 Autenticidad | 38 (30–45, media) | El maestro es real pero mínimo. Las columnas no tienen términos de pago, moneda, banco, cuentas por defecto ni estado activo/bloqueado (`information_schema` de `suppliers`). | Esos campos. |
| 2 Corrección | 35 (28–42, media) | Se crearon dos proveedores con el RNC 131246753 (ambos 201): CMP-03. Un RNC de 9 dígitos sin `identityDocumentTypeCode` se rechaza como «Cédula» (CMP-16). | Índice único (org, taxId normalizado). |
| 3 Multi-país | 55 (45–62, baja) | La validación del documento es por país (RNC/Cédula DO verificados). Otros países no probados. | — |
| 4 Arquitectura | 45 (38–52, media) | No hay índice en `organization_id` ni en `taxId`. `findAll` sin paginación (solo `limit` opcional). DELETE físico. | Índices y paginación. |
| 5 Higiene | 50 (42–58, media) | Importa `users`, `saas` y `localization` (module-boundaries). | — |
| 6 Calidad | 60 (50–68, baja) | Servicio pequeño y legible. | — |
| 7 Robustez | 45 (38–52, media) | Listado completo sin límite por defecto. | — |
| 8 Seguridad | 68 (60–74, media) | Prueba en vivo del 2026-11-07 a las 13:47, con AUTH_THROTTLE_LIMIT=200. qa-do-b sobre el proveedor de qa-do-cmp: GET, PATCH, DELETE y statement → 404, y el nombre quedó intacto (SQL). qa-do-a-member → 403 en GET /suppliers, POST y DELETE. La whitelist rechaza `organizationId` e `id` (400). | Auditoría de cambios (CMP-18). |
| 9 Pruebas | 35 (28–45, media) | Solo una spec de búsqueda. | Specs de unicidad, validación y borrado. |
| 10 Operabilidad | 35 (28–45, baja) | No hay auditoría de cambios de RNC ni de datos bancarios, que es un vector clásico de fraude. | Bitácora antes/después. |
| 11 UX | 50 (40–60, baja) | Hay formulario y lista. No se hizo humo. El error «Cédula» confunde con un RNC (CMP-16). | — |
| 12 Competitividad | 35 (28–45, baja) | Por debajo de QuickBooks, que ya trae términos y 1099. | — |

## 5. Compuertas
| # | Estado |
|---|---|
| 1 Sin fachadas | Cumple, pero faltan básicas |
| 2 Integridad | No cumple (CMP-03) |
| 3 Aislamiento | Cumple (probado en vivo) |
| 4 Validación | Cumple con reservas |
| 5 Humo | Sin 500 en lo probado |
| 6 País | Parcial |
| 7 Pruebas | No cumple (cobertura mínima) |
| 8 Auditoría | No cumple |
| 9 Migraciones | Cumple |
| 10 Observabilidad | Mínima |
| 11 UI | No verificado |
| 12 Documentación | Parcial |

## 6. Hallazgos
- **CMP-03** · Alta · RNC duplicado entre proveedores
  - Habilita el NCF duplicado en AP (ver accounts-payable.md).
  - Ubicación: `suppliers.service.ts` (`create`, sin comprobación) y la tabla sin índice único.
  - Forma correcta: índice único parcial `(organization_id, upper(regexp_replace(taxId,…)))`. El servicio ya tiene `findByTaxId`, pero `create` no lo usa.
  - Esfuerzo: S.
- **CMP-16** · Media · UX/validación
  - `taxId` de 9 dígitos sin tipo se interpreta como Cédula y da 422 `document_invalid {document: "Cédula"}`, con un RNC válido (dígito verificador comprobado a mano).
  - Lo esperable es inferir el tipo por longitud: 9 = RNC, 11 = Cédula.
  - Ubicación: `IdentityDocumentService.resolveParty` (vía `suppliers.service.ts:resolveIdentityDocument`).
  - Esfuerzo: S.
- **CMP-17** · Alta · Faltan básicas
  - No hay términos de pago, moneda, cuentas bancarias, cuenta de gasto por defecto ni estado activo/bloqueado.
  - Sin cuentas bancarias del proveedor no se pueden generar pagos electrónicos.
  - Esfuerzo: M.
- **CMP-18** · Media · Auditoría
  - Los cambios de RNC, email o banco no dejan rastro.
  - Esfuerzo: M.
- **CMP-19** · Media · Rendimiento
  - No hay índice en `organization_id`.
  - `GET /suppliers` devuelve todo sin paginar.
  - Esfuerzo: S.
- **CMP-20** · Baja · Borrado físico
  - Se protege solo con `vendor_bills` y `purchase_orders` como dependientes.
  - No revisa `vendor_debit_note`, `payment_batches`, requisiciones ni recepciones. Las FKs lo atajarían, pero con un error genérico.
  - Forma correcta: desactivar en lugar de borrar.
  - Esfuerzo: S.

## 7. Camino mínimo
1. CMP-03, unicidad (S).
2. CMP-16 (S).
3. CMP-17, términos, banco y bloqueo (M).
4. CMP-19 (S).
5. CMP-18 (M).

## 8. Camino a 100
| Mejora | Impacto | Esfuerzo |
|---|---|---|
| Campos básicos | +15 | M |
| Unicidad e índices | +8 | S |
| Auditoría | +6 | M |
| Validación contra el registro DGII | +5 | M |
| Contactos múltiples | +3 | S |
| Evaluación del proveedor | +3 | M |

## 9. Competitividad
Faltan básicas en todos los líderes comparados. No veo diferenciador. Confianza media.

## 10. Fortalezas
- Validación de documentos por país.
- Medición SaaS dentro de la misma transacción.
- Bloqueo de borrado con dependientes.

## 11. No verificado
- Validación de documentos de otros países.
- UI.
- Aislamiento y authZ: verificados en vivo después.
