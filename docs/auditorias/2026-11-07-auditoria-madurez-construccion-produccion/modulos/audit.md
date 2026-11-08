# Ficha — audit (pista de auditoría + ajustes de auditoría propuestos)
Familia PLTA · 2026-11-07 · Diagnóstico (no se modificó código). Tenant propio qa-do-plt (org 99b47813…), datos con prefijo QA-PLTA-.

## 1. Identificación
- Backend: `apps/backend/api/src/app/audit/` (17 archivos, ~1.670 líneas sin specs; 4 specs). Endpoints: `GET /audit`, `GET /audit/entities`, `GET|POST /audit/adjustments`, `GET /audit/adjustments/:id`, `GET /audit/adjustments/approval-route`, `POST /audit/adjustments/:id/evidence`. Tablas: `audit_logs`, `proposed_adjustments`, `proposed_adjustment_evidence`.
- Mecanismo: `FinancialAuditSubscriber` (TypeORM, `financial-audit.subscriber.ts`) audita ~55 tablas listadas en `AUDITED_TABLES` (l.197-260) en la misma transacción; `AuditTrailService.record/recordWithManager` para eventos manuales (login, cierres, exportaciones); `AuditAccessInterceptor` para READ/EXPORT de informes.
- Países: transversal. Núcleo para vender: sí (SOX/controles internos, requisito de cualquier cliente grande).

## 2. Estándar de referencia
(a) Básicas: quién/cuándo/qué/antes/después en toda mutación sensible (documentos, maestros, configuración, usuarios y permisos); inmutable; filtrable y exportable por el auditor; retención configurable. Avanzadas: evidencia a prueba de manipulación (hash encadenado), registro de lecturas de datos sensibles, alertas. (b) Invariantes: ninguna mutación financiera sin fila; la fila vive en la transacción del cambio; un tenant nunca ve la pista de otro. (c) SAP (change documents CDHDR/CDPOS), NetSuite System Notes (campo a campo, en todos los registros), Dynamics 365 database log, Odoo mail.tracking (campo a campo en modelos marcados) — confianza media (conocimiento general, no re-verificado en web en esta sesión). (d) Captura central (subscriber/CDC) + tabla append-only con índice (tenant, fecha) + catálogo de qué se audita como dato.

## 3. Resultado
- **Madurez: 58 (50–64, confianza media-alta)**. Preparación comercial: 60. **Veredicto: Piloto controlado**. Eje más débil: 1/10 (cobertura incompleta de mutaciones). Críticos abiertos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad/completitud | 55 (48–62, alta) | Prueba real: POST/PATCH/DELETE `/customers` en qa-do-plt → 3 filas CREATE/UPDATE/DELETE con user_id, IP, previous_value/new_value correctos (teléfono 8095550101→8095550199). Pero `users`, `user_roles` NO están en `AUDITED_TABLES`: `select … from audit_logs where entity ilike '%user%'` → solo LOGIN/LOGIN_FAILED/REFRESH (0 cambios de usuario/rol asignado). Transiciones vía `repository.update()` no se auditan (ver PLT-AUD-01) | Auditar users/user_roles/memberships; cubrir `update()`/QueryBuilder |
| 2 Corrección/integridad | 60 (52–66, media) | Fila escrita con `event.manager` (misma transacción) — correcto. Pero la falla al escribir se traga con `logger.error` (subscriber l.137-147, `record()` l.87-95): la mutación procede sin traza | Fallar la transacción o encolar reintento verificable; conciliación documentos↔trail |
| 3 Multi-país | N/A | Transversal | — |
| 4 Arquitectura | 62 (55–68, media) | Subscriber central bien pensado; catálogo de tablas hardcodeado en código; `listenTo(Object)`; consulta cruda a `users` desde audit (`audit.service.ts` find) | Catálogo como dato/decorador por entidad; puerto de identidad para nombres |
| 5 Higiene | 65 (media) | Módulo pequeño, adjustments separado para evitar ciclo (audit.module.ts comentario) | — |
| 6 Calidad | 70 (media) | Tipado razonable; muchos comentarios largos narrativos | — |
| 7 Robustez/rend. | 50 (42–58, media) | Solo índices simples (`user_id`, `organization_id`, `entity`, `entity_id`) — `pg_indexes`; listado ordena por `created_at` filtrando por org sin índice compuesto; sin particionado ni retención; 12.016 filas solo de bank_transactions CREATE en pocos tenants QA | Índice (organization_id, created_at DESC), (organization_id, entity_id); particionado mensual; política de retención |
| 8 Seguridad/aislamiento | 72 (65–78, alta) | qa-do-b `GET /audit?entityId=<cliente de plt>` → `rows:[]`; `?organizationId=` → 400 whitelist; qa-do-a-member → 403; `pageSize=100000` → 400 (máx 200). Append-only: trigger `trg_audit_logs_append_only` habilitado; `virtex_app` sin UPDATE/DELETE/TRUNCATE (has_table_privilege=f). Sin RLS en audit_logs (organization_id nullable) — aislamiento solo de aplicación | Hash encadenado/firma; RLS con rama para filas de plataforma |
| 9 Pruebas | 62 (media) | 4 specs pasan (dentro de 55 suites/534 tests PLTA verdes); no hay prueba que falle si una tabla sensible nueva no se audita | Test que recorra entidades con organizationId y exija clasificación auditada/no auditada |
| 10 Operabilidad | 55 (media) | Falla de auditoría solo en log; sin métrica/alerta | Métrica `audit_write_failures_total` + alerta |
| 11 UX | 55 (baja) | Hay `recordLabel`/`actorName`; pantalla frontend no probada en esta sesión | Exportación del trail para auditor externo; diff visual |
| 12 Competitividad | 50 (media) | Frente a NetSuite System Notes (todos los registros, campo a campo), cobertura parcial | Cobertura total + exportación + hash |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | No cumple (parcial) | users/roles asignados y transiciones por `update()` sin traza |
| 2 | Cumple con reservas | misma transacción; fallo tragado |
| 3 | Cumple | prueba qa-do-b, member |
| 4 | Cumple | DTO whitelist, máx 200 |
| 5 | Cumple | sin 500 en pruebas |
| 6 | N/A | — |
| 7 | Parcial | specs existen; sin test de cobertura |
| 8 | **No cumple** | ver PLT-AUD-01/02 |
| 9 | Cumple | migración append-only reversible |
| 10 | Parcial | — |
| 11 | No verificado | — |
| 12 | Parcial | comentarios en código; sin guía de operación de la pista |

## 6. Hallazgos
- **PLT-AUD-01** · audit · eje 1/2 · integridad de datos · **Alta** · `sales/services/quotes.service.ts:274,312` (+ todo `repository.update()`/`manager.update()` sobre tablas auditadas, p.ej. `procurement/purchase-orders.service.ts:272,651`) · El subscriber descarta eventos sin `id` en la entidad (subscriber l.106-110), y `update()` de TypeORM emite `afterUpdate` solo con los valores SET. Evidencia en BD: la cotización `5f557826…` está en `INVOICED` y su pista tiene solo `CREATE:DRAFT` (`select … from quotes q where status='INVOICED'`). Igual, 9/9 `vendor_bills` DRAFT sin UPDATE es coherente, pero las transiciones ACCEPTED/INVOICED no dejaron rastro. · Forma correcta: prohibir `update()` en tablas auditadas (lint/verify) o auditar explícitamente con `recordWithManager`; o trigger de BD genérico. · Riesgo operativo / bloquea venta a auditados. · M.
- **PLT-AUD-02** · audit/users · eje 1 · seguridad/operabilidad · **Alta** · `audit/financial-audit.subscriber.ts:197-260` (lista sin `users`, `user_roles`, `organization_members`), `users/users.service.ts` (solo lee la pista, l.782) · Cambio de rol asignado, desactivación o cambio de organización de un usuario no quedan registrados con antes/después (BD: 0 filas UPDATE de usuarios). · Auditar asignaciones de rol y estado de usuario. · Bloquea venta (SOX/ISO 27001 piden trazabilidad de accesos). · S.
- **PLT-AUD-03** · audit · eje 2/10 · integridad · Media · `financial-audit.subscriber.ts:137-147`, `audit.service.ts:87-95` · Si el INSERT del trail falla, la operación sigue y solo hay `logger.error`; no hay métrica ni conciliación implementada (el comentario dice que "la conciliación es el control", grep `reconcil` en audit/: 0). · Fallar o reintentar + métrica. · M.
- **PLT-AUD-04** · audit · eje 7 · rendimiento · Media · migración baseline (índices simples) · Sin índice compuesto (organization_id, created_at) ni retención/particionado; tabla de crecimiento ilimitado. · Índice compuesto + particionado. · S/M.
- **PLT-AUD-05** · audit · eje 8 · seguridad · Media · `1789340000000-AuditLogAppendOnly.ts` · Inmutabilidad depende de trigger y privilegios; un superusuario/propietario la desactiva sin rastro y TRUNCATE no lo cubre el trigger (sí lo cubre el privilegio). Sin hash encadenado. · Hash encadenado por tenant + exportación periódica WORM. · M.

## 7. Camino mínimo a producción
1. Auditar users/user_roles/membresías (S). 2. Cubrir `update()` en tablas auditadas (verificador + llamadas explícitas) (M). 3. Índice compuesto (S). 4. Métrica/alerta de fallo de escritura (S). Retocar, no rehacer. Todos los países.

## 8. Camino a 100
Cobertura total verificada por test (+12, M); hash encadenado (+6, M); particionado/retención (+5, M); exportación para auditor externo y diff UI (+5, M); RLS (+3, S).

## 9. Competitividad
Básicas faltantes: trazabilidad de cambios de usuarios/roles; transiciones de estado completas. Diferenciador: auditoría de LECTURA/EXPORT de informes (pocos ERPs medianos la tienen). Fuentes: NetSuite System Notes / SAP change documents (confianza media, conocimiento general).

## 10. Fortalezas
Subscriber transaccional; append-only con trigger + REVOKE; DTO estricto y paginación máx 200; redacción de campos secretos (`SECRET_FIELD`); actor desde contexto de tenant; READ/EXPORT.

## 11. No verificado
Pantalla de auditoría del portal; ajustes de auditoría propuestos de punta a punta (requiere año cerrado; no ejecutado); RLS (la API corre como superusuario).
