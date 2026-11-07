# Flujos y aprobaciones (T23) — workflow-engine, workflows, my-work, frontend workflow/approvals

> Sin hallazgos CRÍTICOS de seguridad abiertos. Las condiciones del motor NO usan eval/Function (verificado).

## 1. Identificación
- Backend: `workflow-engine/` (28 archivos, 5 397 LOC, 4 specs; ~26 endpoints: definiciones CRUD/validar/publicar/versionar/duplicar, instancias iniciar/cancelar/reintentar, eventos, tareas, catálogos), `workflows/` (11 archivos, 1 215 LOC, 1 spec de 524 LOC; políticas de aprobación multi-paso + aprobar/rechazar), `my-work/` (6 archivos, 235 LOC; `approvals/inbox`, `me/inbox`). Tablas: workflow_definitions/instances/tasks/transitions, approval_policies/_steps/requests/step_actions.
- Frontend: `features/workflow` (35 archivos, 8 911 LOC: `designer/`, `list/`, `instances/`, `tasks/`, `shared/`), `features/approvals` (6 archivos, 314 LOC). Rutas en `workspace.manifest.ts:204-262` (approvals, workflows, workflows/:id/edit, workflow-instances, workflow-tasks).
- Países: N/A (motor transversal). Dependencias: notificaciones, directorio de usuarios/roles, fuentes de aprobación de cada dominio (journal-entries, accounts-payable, audit, procurement).
- ¿Núcleo para vender? Sí para mediana empresa (controles de aprobación/segregación de funciones).

## 2. Estándar de referencia
(a) Básico: definir aprobaciones por tipo de documento con umbrales por monto y roles; bandeja única; bloqueo en servidor del documento hasta aprobar; delegación/ausencias; escalamiento; auditoría de decisiones; segregación (quien crea no aprueba). Avanzado: diseñador visual BPM, disparo por eventos, timers/SLA, subprocesos, acciones automáticas (webhook, actualizar registro), versionado de definiciones con instancias en vuelo, compensación/reintento, simulación.
(b) Invariantes: una decisión por tarea (concurrencia), instancias atadas a la versión con la que arrancaron, expresiones sin ejecución de código, side effects sólo tras commit (outbox), aislamiento por tenant, el documento no avanza sin aprobación.
(c) NetSuite SuiteFlow (estados/transiciones/acciones/condiciones con fórmulas sandbox; aprobaciones de OC/facturas con umbrales), Power Automate (conectores, aprobaciones con bloqueo vía Dataverse), Odoo Studio/Approvals (reglas por modelo y monto). Confianza media (conocimiento público general, sin consulta en línea).
(d) Construcción de referencia: grafo como datos + intérprete; tokens; tabla de transiciones (historial); outbox para efectos; locks por instancia; cron por tenant para timers.

## 3. Resultado
Madurez **56** (48–62, confianza media: motor leído en profundidad, no se ejecutó una instancia E2E por presupuesto) · Preparación **55 — Piloto controlado** · Eje más débil: Higiene/arquitectura (tres mecanismos de aprobación paralelos) y Robustez de efectos externos · Críticos abiertos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 62 (55–68, media) | Motor real: start/complete/cancel/retry/timers/escalado (`workflow-engine.service.ts:119-405`), validador de grafo 703 LOC, catálogo de eventos de negocio (`events/workflow-event.catalogue.ts:113-270`). Políticas multi-paso reales para VENDOR_BILL, JOURNAL_ENTRY, AUDIT_ADJUSTMENT. | PAYMENT_BATCH y PERIOD_REOPENING declarados en el enum (`approval-policy.entity.ts:6-11`) sin handler ni `startApprovalProcess` (grep). Sin delegación/ausencias (grep `delegat` sin resultados relevantes en estos módulos — no verificado exhaustivo). Sin compensación. |
| 2 Corrección | 58 (50–65, media) | Lock pesimista en tarea e instancia (`:180-216`), outcomes validados, comentario obligatorio en rechazo, formularios tipados y lista blanca de campos (`:197-214`), límite de pasos (`:425`). Efectos (notificaciones) post-commit (`:600+`). | Las acciones `webhook`, `start_workflow` y `document_decision` ejecutan efectos fuera de la transacción de la instancia (`actions/builtin-actions.ts:142-160`, `:174-181`; `actions/document-actions.ts:110-112`): si la tx de la instancia hace rollback, el webhook ya salió y el documento ya quedó aprobado. Sin outbox. |
| 3 Multi-país | N/A | Transversal. | — |
| 4 Arquitectura | 55 (48–62, media) | Grafo como datos + intérprete, registro de acciones, fuentes de aprobación por dominio. | Tres mecanismos de aprobación: `workflows` (políticas), máquinas de estado por módulo (OC/requisiciones en `procurement`), y el motor BPM; se puentean con `document_decision`. Debería ser uno (políticas = plantillas del motor). |
| 5 Higiene | 52 (45–60, media) | `workflow-approval.source.ts` duplicado en `workflow-engine/` y `workflows/`. | Unificar; un dueño para "aprobación". |
| 6 Calidad | 70 (62–75, media) | Código tipado, errores localizados, límites explícitos. | Comentarios muy extensos que afirman correcciones (verificar siempre). |
| 7 Robustez | 55 (48–62, media) | Barrido por tenant con `SWEEP_BATCH=200` y `skip_locked` (`:321-371`). | HTTP de webhook dentro de una tx abierta con lock (latencia → locks retenidos); timers en cron in-process (sin cola distribuida verificada). |
| 8 Seguridad | 70 (62–76, media) | Predicados: árbol de datos, sin eval (`contracts/workflow-predicate.ts:11-66`; grep `eval(\|new Function\|vm\.` = 0 en el módulo), sin recorrer prototipo (`:69-80`), profundidad acotada. SSRF: resolución DNS y bloqueo de rangos privados, `redirect: manual` (`security/safe-webhook.ts:57-77`). Todos los endpoints con `@HasPermission` y filtro `organizationId`. | SSRF con TOCTOU de DNS rebinding: valida con `lookup()` y luego `fetch` vuelve a resolver (`safe-webhook.ts:57` vs `:77`). IDOR por API no probado (presupuesto). |
| 9 Pruebas | 60 (52–66, media) | `workflow-engine.integration.spec.ts` (BD real, se salta sin DB_HOST), validador, helpers, `approval-flow.spec.ts` 524 LOC. | E2E de UI del diseñador; pruebas de rollback con acciones externas. |
| 10 Operabilidad | 58 | Tabla de transiciones como historial; logs de fallo; notificación de instancia fallida. | Métricas de instancias atascadas/tiempos de ciclo. |
| 11 UX | 50 (40–60, baja) | Diseñador real (`features/workflow/designer`), vista runtime de instancia; no ejecutado en navegador. F2 observó 403 para ADMINISTRATOR en Inicio (cruce). | Verificar en UI; bandeja unificada (hay `approvals` y `workflow-tasks` separadas). |
| 12 Competitividad | 55 | Diseñador + eventos + timers + subprocesos ≈ SuiteFlow básico. | Delegación, SLA por calendario laboral, umbrales de OC en políticas, conectores. |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | Cumple con reservas | Motor real; 2 tipos de documento declarados sin implementación. |
| 2 Integridad | Cumple con reservas | Locks y tx; efectos externos fuera de tx (WF-02). |
| 3 Autorización/aislamiento | Cumple (estático) | `@HasPermission` + `organizationId` en servicios; no probado por API. |
| 4 Validación servidor | Cumple | Validador de grafo; DTO con whitelist (validate rechazó campos no declarados: 400 VALIDATION_FAILED). |
| 5 E2E sin 500 | No verificado | — |
| 6 Cumplimiento país | N/A | — |
| 7 Pruebas en CI | Cumple parcial | Integración se salta sin DB_HOST. |
| 8 Auditoría | Cumple | `workflow_transitions`, `approval_step_actions`. |
| 9 Migraciones | Cumple | Global sin deriva. |
| 10 Observabilidad | Parcial | Logger Nest; sin correlación verificada. |
| 11 UI | No verificado | — |
| 12 Documentación | Parcial | Comentarios en código; sin guía de operación. |

## 6. Hallazgos
- **WF-01** · workflows/procurement · Eje 4/5 · Arquitectura · **Alta** · `workflows/entities/approval-policy.entity.ts:6-11`; `procurement/purchase-orders.service.ts:327`; `workflow-engine/actions/document-actions.ts` · Tres mecanismos de aprobación independientes; las OC no usan políticas (no hay umbral por monto ni pasos por rol: cualquier OC pasa por PENDING_APPROVAL→APPROVED con un único aprobador distinto del creador). Sí bloquea en servidor: recibir exige SENT/PARTIALLY_RECEIVED (`purchase-orders.service.ts:403`) y SENT sólo desde APPROVED (`procurement-lifecycles.ts:76-78`). · Forma correcta: un único servicio de aprobaciones (políticas por tipo de documento y monto) consumido por todos los dominios, con el motor como ejecutor. · Brecha competitiva/deuda · L.
- **WF-02** · workflow-engine · Eje 2 · Integridad · **Alta** · `actions/builtin-actions.ts:142-160,174-181`, `actions/document-actions.ts:110-112`, `workflow-engine.service.ts:472` · Las acciones automáticas se ejecutan dentro de `run()` pero sin el `EntityManager` de la tx: webhook, subproceso y aprobación del documento quedan aplicados aunque la tx de la instancia falle o haga rollback; sin compensación. · Outbox transaccional para efectos externos; pasar `tx` a acciones internas; acciones con idempotency key. · Riesgo operativo · M.
- **WF-03** · workflow-engine · Eje 8 · Seguridad · **Media** · `security/safe-webhook.ts:57,77` · Protección SSRF valida la IP con `lookup` y luego `fetch` resuelve de nuevo (DNS rebinding). · Conectar a la IP validada (agent con `lookup` fijado). · Riesgo · S.
- **WF-04** · workflows · Eje 1 · Funcionalidad incompleta · **Media** · `approval-policy.entity.ts:8,10` · PAYMENT_BATCH y PERIOD_REOPENING se pueden configurar como política pero ningún servicio llama `startApprovalProcess` con ellos (grep: sólo journal-entries, accounts-payable, audit-adjustments). Una política creada para ellos no tiene efecto. · Quitar del enum o implementar. · Riesgo (control que el cliente cree activo) · S/M.
- **WF-05** · workflow-engine · Eje 7 · Robustez · **Media** · `workflow-engine.service.ts:416-454` · Llamadas HTTP dentro de una transacción con `pessimistic_write` sobre la instancia; un webhook lento retiene locks y conexiones. · Ejecutar acción externa fuera de la tx (outbox) y reanudar. · S/M.
- **WF-06** · workflow-engine · Eje 2 · Bug menor · **Baja** · `contracts/workflow-predicate.ts:41-54` · `ne`/`nin` devuelven true si la variable no existe; comparaciones de importes en `Number` (float). · Documentar o tratar "ausente" explícitamente. · S.

## 7. Camino mínimo a producción
1. Outbox para acciones externas y aprobación de documento dentro de la tx (WF-02) — M.
2. Retirar del enum los tipos no implementados (WF-04) — S.
3. Fijar IP en webhook (WF-03) — S.
4. Prueba E2E: OC/factura de proveedor con política de 2 pasos, bloqueada hasta aprobar — M.

## 8. Camino a 100
Unificar aprobaciones (WF-01, +8, L) → outbox/compensación (+6, M) → delegación/ausencias y SLA laborales (+5, M) → umbrales por monto en OC (+4, M) → métricas de procesos (+3, S) → simulación/pruebas de definiciones (+3, M).

## 9. Competitividad
Brechas básicas: delegación/sustitutos, umbrales por monto para OC, aprobación por correo/móvil (no verificado). Avanzadas: conectores externos, SLA. Diferenciadores: diseñador visual con predicados seguros, disparo por eventos de negocio, subprocesos y timers, segregación creador≠aprobador. Nota 55 (45–62, media). Fuentes: documentación pública NetSuite SuiteFlow / Power Automate Approvals (confianza media, no consultada en línea).

## 10. Fortalezas a preservar
Evaluador de predicados sin código; lista blanca de campos de formularios; locks por tarea/instancia; efectos de notificación post-commit; validador de grafo; filtro SSRF.

## 11. No verificado
Ejecución E2E de una instancia (el `definitions/validate` respondió 400 por forma de DTO distinta a la supuesta; no se reintentó por presupuesto); IDOR por API; UI del diseñador; delegación. Cobertura: ~35 % de archivos backend leídos, 1 endpoint ejecutado, 0 pantallas.

<!-- RESUMEN: modulo=flujos-y-aprobaciones; madurez=56; prep=55; veredicto=Piloto controlado; eje_debil=Higiene/Arquitectura; criticos=0; altos=2; camino_min=M -->
