# Auditoría / rastro de cambios (T12) — familia F2

> Auditoría 2026-10-31. Diagnóstico sin cambios en el repo. Tenant qa-a.

## ⚠ Hallazgo destacado (Alta, roza Crítica para clientes auditados)
**AUD-01 — El rastro automático de documentos financieros NO registra quién ni desde dónde.** `FinancialAuditSubscriber` toma el autor de `RequestContext.currentContext?.req` (`audit/financial-audit.subscriber.ts:9,94-110`), pero el módulo `RequestContextModule` de `nestjs-request-context` no se registra en ninguna parte (grep `RequestContextModule|nestjs-request-context` en `apps/backend/api/src` → sólo los dos imports). Resultado medido en BD: **todas** las filas de `products`, `customers`, `suppliers`, `organization_settings`, `ledgers`, `accounting_periods`, `document_sequences` tienen `user_id NULL`; `ip_address` es NULL en las 157+ filas de la tabla. Reproducción: con qa-a, POST `/inventory` (`QA-F2-Prod A`) y PATCH precio 50→75 → filas `CREATE|products|85aa21f4…|user_id NULL|ip NULL` y `UPDATE|products|…|NULL|NULL`. El comentario del propio archivo dice que el objetivo es "who made it". Para facturas, pagos, nómina, empleados, presupuestos… (las 36 tablas de `AUDITED_TABLES`) el "quién" se pierde.

## 1. Identificación
- Backend `audit/` (17 archivos, ~1.6k LOC, 3 specs): `audit.service.ts` (AuditTrailService: `record`, `recordWithManager`, `findByActor`), `financial-audit.subscriber.ts` (suscriptor TypeORM sobre 36 tablas), `audit-access.interceptor.ts` + `@AuditAccess` (lecturas/exportaciones sensibles, 18 usos: estados financieros, nómina, TSS, DGII, PII de empleados), `adjustments/` (ajustes de auditoría propuestos con evidencia y aprobación). Endpoints: GET `/audit`, `/audit/entities`, `/audit/adjustments*`.
- Tabla `audit_logs` (id, user_id, organization_id, entity, entity_id, actionType [CREATE/UPDATE/DELETE/LOGIN/LOGOUT/LOGIN_FAILED/REFRESH/IMPERSONATE/READ/EXPORT], ip_address, previous_value, new_value jsonb, created_at). Sin RLS (clasificada cross-tenant).
- Uso explícito de `AuditTrailService` en 26 archivos (auth, users, journal-entries, workflows, period-closing, year-end, payment, chart-of-accounts).
- Países: transversal. Núcleo para vender: sí (SOX/controles internos, auditores externos).

## 2. Estándar de referencia
- (a) Básico: quién/cuándo/qué/antes-después/desde dónde para toda creación, modificación, anulación y borrado de documentos y maestros financieros, cambios de permisos/roles/usuarios, configuración fiscal (impuestos, secuencias), accesos y exportaciones; inmutable (append-only); consultable y exportable por el cliente; retención configurable. Avanzado: firma/encadenado hash, field-level history en UI de cada registro, alertas sobre acciones sensibles, retención legal por país.
- (b) Invariantes: ninguna escritura sensible sin rastro; el rastro no puede ser modificado por la aplicación; el autor es el principal autenticado (o "sistema" explícito).
- (c) Líderes: Dynamics 365 "Database log" + "Audit trail" por tabla/campo (confianza alta, docs Microsoft); NetSuite "System Notes" automáticas en cada registro con usuario, contexto y antes/después (confianza alta, docs Oracle); Odoo `mail.tracking` por campo + módulo audit log (confianza media); Salesforce Field History + Setup Audit Trail (confianza alta).
- (d) Construcción: captura en la capa de persistencia con el principal en contexto ambiente; tabla append-only con REVOKE UPDATE/DELETE al rol de app o trigger que lo impida; particionado por fecha.

## 3. Resultado
- **Madurez: 35 (30–42, confianza media-alta)** (tope = eje 2; el promedio de ejes aplicables ≈49 — difiere >10 porque el defecto de autor nulo invalida el valor probatorio de todo el rastro automático) — el mecanismo existe y se ejecuta, pero no registra autor ni IP en el camino principal y deja fuera roles, permisos, impuestos y documentos.
- **Preparación comercial: 45 — No listo** (compuerta 8 no cumple).
- Eje más débil: Corrección/integridad (autor nulo; tabla mutable).
- Críticos: 0 (AUD-01 alto, con impacto de venta en clientes auditados). Altos: 3.

## 4. Ejes
| Eje | Nota | Evidencia | Falta para 100 |
|---|---|---|---|
| 1 Autenticidad/completitud | 50 (42–58, media) | Suscriptor real sobre 36 tablas; lecturas sensibles con `@AuditAccess`; asientos con `recordWithManager` en la misma transacción (`journal-entries.service.ts:731`) | Cobertura de roles, permisos, impuestos, cuentas, documentos, sucursales |
| 2 Corrección/integridad | 35 (28–45, alta) | AUD-01 autor/IP nulos; AUD-02 tabla mutable | Contexto de request registrado; append-only |
| 3 Multi-país | N/A | Retención por país no modelada (verificar con contador/abogado local) | — |
| 4 Arquitectura | 58 (50–65, media) | Suscriptor genérico + servicio explícito + interceptor de acceso: buen diseño en capas | Un solo mecanismo de contexto (AsyncLocalStorage de tenancy ya existe: `shared/tenancy/tenant-context.ts`) |
| 5 Higiene | 55 (48–62, media) | Dos fuentes de contexto (RequestContext muerto vs ALS vivo) | Unificar |
| 6 Calidad | 60 (52–66, media) | Errores de auditoría logueados, no tragados (`audit.service.ts:89-95`) | — |
| 7 Robustez | 55 (45–62, baja) | Una fila por cambio en la misma transacción; sin particionado ni índice por fecha verificado | Particionado/retención |
| 8 Seguridad | 45 (38–52, media) | `virtex_app` tiene UPDATE y DELETE sobre `audit_logs` (`information_schema.role_table_grants`), sin trigger que lo impida (`pg_trigger` sin filas para la tabla); sin RLS; GET `/audit` filtra por organización y exige `AUDIT_VIEW_TRAIL` | REVOKE UPDATE/DELETE; RLS |
| 9 Pruebas | 45 (38–55, media) | `financial-audit.spec.ts` existe pero no detectó AUD-01 (no ejecuta con request real) | Prueba E2E: request autenticada → fila con user_id |
| 10 Operabilidad | 50 (42–58, baja) | Errores de auditoría a log de error | Alerta si filas sin autor > 0 |
| 11 UX | 50 (40–60, baja) | Pantalla de auditoría existe (no recorrida en detalle) | Historial por registro |
| 12 Competitividad | 40 (32–50, media) | Por debajo de NetSuite System Notes / D365 | Historial por campo en cada ficha |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | Cumple | filas reales en `audit_logs` |
| 2 Integridad | No cumple | AUD-01, AUD-02 |
| 3 Aislamiento | Cumple con reservas | lectura filtrada por org; tabla sin RLS |
| 4 Validación | Cumple | `limit` rechazado por whitelist (GET `/audit?limit=5` → 400) |
| 5 E2E | No verificado por UI | — |
| 6 País | N/A | — |
| 7 Pruebas CI | No cumple | ninguna prueba detecta autor nulo |
| 8 Auditoría de negocio | **No cumple** | muestreo abajo |
| 9 Migraciones | Cumple | — |
| 10 Observabilidad | Parcial | — |
| 11 UI | No verificado | — |
| 12 Docs | Parcial | — |

## 6. Hallazgos

**Muestreo de 15 operaciones sensibles** (E = ejecutada por API con qa-a y consultada `audit_logs`; C = verificada en código):
| # | Operación | ¿Rastro? | Autor | Fuente |
|---|---|---|---|---|
| 1 | Crear producto (E) | Sí | **NULL** | BD |
| 2 | Cambiar precio de producto (E) | Sí (antes/después) | **NULL** | BD |
| 3 | Crear impuesto `QA-F2-Tax` (E) | **No** | — | BD, `taxes` no está en `AUDITED_TABLES` |
| 4 | Cambiar tasa de impuesto 5→7 (E) | **No** | — | BD |
| 5 | Subir documento (E) | **No** | — | BD |
| 6 | Borrar documento (E, DELETE 204) | **No** | — | BD |
| 7 | Login (E) | Sí | Sí (user_id) | BD (`User|LOGIN`, IP NULL) |
| 8 | Crear/actualizar asiento (C + BD previas) | Sí | Sí | `journal_entries` 15 CREATE/2 UPDATE con user_id |
| 9 | Crear/editar rol y permisos (C) | **No** | — | `roles/roles.service.ts` sin llamadas a auditoría (grep) |
| 10 | Cambiar roles/datos de usuario PATCH `/users/:id` (C) | **No** | — | `users/users.controller.ts:250-262` sin `record` |
| 11 | Cambiar estado de usuario PATCH `/users/:id/status` (C) | **No** | — | ídem 283-298 |
| 12 | Borrar usuario (C) | Sí | Sí | `users.controller.ts:275` |
| 13 | Cambio de email por admin (C) | Sí | Sí | `users.controller.ts:350` |
| 14 | Facturas / cobros / nómina (C) | Sí | **NULL** (mismo suscriptor) | `financial-audit.subscriber.ts:156-205` |
| 15 | Exportar reporte DGII / estados financieros (C) | Sí (READ/EXPORT) | probable sí (interceptor con principal, no ejecutado) | `@AuditAccess` |
Resultado: 5/15 con rastro completo, 4/15 con rastro sin autor, 6/15 sin rastro.

**AUD-01** — Alta — integridad de datos — `audit/financial-audit.subscriber.ts:94-110`; arriba. Forma correcta: tomar el principal de `currentTenantStore()` extendido con `userId`/`ip` (ya existe el ALS en `shared/tenancy/tenant-context.ts`), o registrar `RequestContextModule`; prueba de integración que lo afirme. Impacto: bloquea la venta a clientes con auditoría externa/SOX. Esfuerzo: S.

**AUD-02** — Alta — seguridad — `audit_logs` es mutable para el rol de aplicación: `virtex_app` con SELECT/INSERT/UPDATE/DELETE (consulta `information_schema.role_table_grants`), sin trigger anti-modificación ni hash encadenado. Forma correcta: `REVOKE UPDATE, DELETE ON audit_logs FROM virtex_app` + trigger; opcional hash encadenado. Esfuerzo: S.

**AUD-03** — Alta — funcionalidad incompleta — cambios de seguridad (roles, permisos, asignación de roles a usuarios, estado de usuario) y configuración fiscal (impuestos, cuentas contables — chart-of-accounts sí usa AuditTrail para jobs, no verificado para CRUD) no dejan rastro (tabla de muestreo #3,4,9,10,11). Forma correcta: añadir `roles`, `user_roles`, `users`, `taxes`, `accounts`, `document_nodes` al suscriptor o llamadas explícitas. Esfuerzo: S–M.

**AUD-04** — Media — `ip_address` nunca se registra en ninguna fila (0/157); el login tampoco la guarda. Esfuerzo: S.

**AUD-05** — Media — `audit_logs` sin RLS (clasificada cross-tenant, `tenant-table-classification.ts`); filas con `organization_id` NULL para eventos de usuario. Esfuerzo: M.

**AUD-06** — Baja — la API de lista rechaza `limit` (400 whitelist); paginación no estándar respecto a `common/pagination.ts`.

## 7. Camino mínimo a producción
1. Arreglar contexto de autor/IP del suscriptor + prueba de integración (S). 2. REVOKE UPDATE/DELETE + trigger (S). 3. Cubrir roles/usuarios/impuestos/documentos (S–M).

## 8. Camino a 100
Autor+IP (+15, S); append-only (+8, S); cobertura de seguridad/fiscal (+10, M); historial por registro en UI (+8, M); hash encadenado/exportación firmada (+5, M); retención y particionado (+4, M); alertas de acciones sensibles (+4, M).

## 9. Competitividad
Brecha básica: "System Notes" por registro (NetSuite) y autor fiable. Diferenciador existente: auditoría de LECTURAS sensibles (`@AuditAccess` sobre nómina/PII/estados financieros), poco común en ERPs pymes LatAm (confianza media).

## 10. Fortalezas
Auditoría en la misma transacción (`recordWithManager`); antes/después en UPDATE; auditoría de accesos y exportaciones; errores de auditoría no silenciados.

## 11. No verificado
Pantalla de auditoría; `@AuditAccess` ejecutado; CRUD de cuentas contables; retención.
Cobertura: ~60 % de `audit/` leído; 7 operaciones ejecutadas, 8 por código.

<!-- RESUMEN: modulo=auditoria-rastro; madurez=35; prep=45; veredicto=No listo; eje_debil=Corrección e integridad; criticos=0; altos=3; camino_min=S -->
