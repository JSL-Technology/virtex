# Ficha — my-work (bandeja de aprobaciones y bandeja por módulo)
Familia PLTA · 2026-11-07 · Diagnóstico.

## 1. Identificación
`apps/backend/api/src/app/my-work/` (6 archivos, 235 l.; 2 specs). Endpoints: `GET /approvals/inbox`, `POST /approvals/inbox/:source/:id/approve|reject` (exigen Idempotency-Key), `GET /me/inbox`. Sin tablas propias: agrega fuentes registradas por los módulos (`ApprovalSourceRegistry`, 7 registros). Panel de trabajos: `GET /me/jobs` (`shared/jobs`). Núcleo: medio.

## 2. Estándar de referencia
Bandeja unificada de tareas/aprobaciones (SAP Fiori My Inbox, Dynamics "Work items assigned to me", NetSuite reminders portlet — confianza media). Invariantes: solo ve/decide quien tiene permiso de decisión y en su tenant; decisión idempotente; fuente caída no tumba la bandeja.

## 3. Resultado
**Madurez 60 (52–66, confianza media)**; preparación 60; **Piloto controlado**. Eje más débil: 9/12. Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 60 (media) | qa-do-plt `GET /approvals/inbox` → `[]`, `/me/inbox` → `[]` (tenant sin pendientes); el contenido real depende de cada fuente | Delegación, vencimientos/SLA visibles |
| 2 | 65 | `approve` exige Idempotency-Key (qa-do-b → 400 `common.idempotency_key_required`) | — |
| 3 | N/A | | |
| 4 | 72 | Patrón registro/puerto (`contracts/approvals`), sin lógica de dominio en my-work | — |
| 5 | 75 | Sin escrituras a tablas ajenas | — |
| 6 | 70 | Pequeño y limpio | — |
| 7 | 55 | `pending()` consulta todas las fuentes en paralelo sin paginación ni límite (approvals-inbox.service.ts `pending`) | Límite/paginación por fuente |
| 8 | 70 (media) | Filtro de fuentes por `decidePermission`; member `GET` → `[]`; decisión verifica permiso (`source()`); aislamiento delegado a cada fuente (no verificado una a una) | Prueba cruzada por fuente |
| 9 | 55 | 2 specs con mocks del registro | Integración con fuentes reales |
| 10 | 55 | Fuente que falla → `logger.error` y lista vacía (silencioso para el usuario) | Indicar fuente degradada en respuesta |
| 11 | 50 (baja) | UI no probada | — |
| 12 | 50 | Sin delegación/sustitutos | — |

## 5. Compuertas
1 Cumple (agregador real) · 2 Cumple · 3 Parcial (depende de fuentes) · 4 Cumple · 5 Cumple · 6 N/A · 7 Parcial · 8 delegada a fuentes · 9 N/A · 10 Parcial · 11 No verificado · 12 Parcial.

## 6. Hallazgos
- **PLT-MW-01** · eje 7 · rendimiento · Media · `my-work/approvals-inbox.service.ts` `pending()` · sin límite: un aprobador con miles de pendientes recibe todo. · Paginación. · S.
- **PLT-MW-02** · eje 10/11 · UX · Media · mismo archivo · fuente caída se oculta como "no hay pendientes"; el aprobador cree que no tiene trabajo. · Devolver `degradedSources`. · S.
- **PLT-JOB-03** (ver queues-cache-jobs) afecta `/me/jobs`.

## 7. Camino mínimo
Paginación (S); fuente degradada visible (S).
## 8. Camino a 100
Delegación y ausencias (+10, M); SLA/escalado visible (+6, M); acciones masivas (+5, S).
## 10. Fortalezas
Contrato de fuentes desacoplado; idempotencia obligatoria en decisiones.
## 11. No verificado
Contenido real con pendientes (tenant propio sin aprobaciones); UI.
