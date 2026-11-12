# Ficha — navegacion-y-cobertura-ux

Familia FE · 2026-11-07/08 · Insumo detallado: `../03-insumo-humo-ui-FE.md`.

## 1. Identificación
- Alcance: 155 rutas declaradas en 8 manifiestos (`apps/core/client-web/src/app/core/modules/manifests/*.ts`), 77 con entrada de menú; 27 secciones de Settings (`features/settings/shell/settings-registry.ts`); cruce con 116 prefijos de controlador del backend.
- Prueba: Playwright (script único `…/scratchpad/agents/fe/smoke.cjs`) con qa-do-a (admin), qa-do-a-member (sin permiso), qa-do-xflow en en/pt y 390 px. Núcleo para vender: sí.

## 2. Estándar de referencia
(a) Básico: toda entrada de menú abre una pantalla funcional; ninguna pantalla sin backend; cada capacidad vendida tiene pantalla; estados vacío/cargando/error/sin permiso; idiomas declarados completos; móvil usable; deep links. Avanzado: navegación adaptada a plan y rol, búsqueda de comandos, accesos recientes. (b) Invariante: lo que el menú ofrece funciona para quien lo ve. (c) Referencia: Odoo/D365 ocultan apps no instaladas o no licenciadas y muestran upsell explícito (confianza media, conocimiento de producto); WCAG 2.1 (alta). (d) Navegación derivada de una sola declaración (aquí sí: manifiestos).

## 3. Resultado
- **Madurez: 52 (45–60, confianza media)**. Preparación: 50. **Veredicto: Piloto controlado**.
- Eje más débil: 1/12 (cobertura: siete dominios con backend y sin pantalla).
- Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Completitud | 45 (38–52, media) | 119/119 rutas sin parámetro cargan; 0 pantallas muertas/«en construcción»; pero backend sin pantalla: `consolidation`, `intercompany`, `manufacturing`, `projects`, `sales/leads`, `sales/opportunities`, `cases`, `customer-portal`, `accounting/inflation-adjustment`, `analytical-reporting`, `customer-groups` (grep de `/<prefijo>` en client-web y pos: 0) | Pantallas para esos dominios o retirarlos de la oferta |
| 2 Corrección | 55 (48–62, media) | Deep links: `/settings/<id>` → `#settings/e` (27/27); `/es/…` y `/en/e/<org>/…` → overview | Corregir guards |
| 3 Multi-país | 60 (50–65, baja) | Secciones de Settings por país (`fiscal` solo DO, `einvoicing-regime` excepto DO, `tax-jurisdictions` US/BR — `settings-registry.ts:180-200`) | Probar con tenants de cada país (no hecho) |
| 4 Arquitectura | 65 (58–70, media) | Menú, router y ventanas derivados del manifiesto (`app.routes.ts:244-253`) | — |
| 5 Higiene | 55 (N/A parcial) | Alias de rutas (`accounting/subsidiary-ledgers`→`partner-ledger`, `inventory/kardex`→`movements`) | — |
| 6 Calidad | N/A | ver frontend-shell | — |
| 7 Robustez | 50 (42–58, media) | Overview: 13 llamadas 403 para un miembro; 403 de plan en cada carga | Inicio consciente de permisos/plan |
| 8 Seguridad | 65 (58–70, media) | 8/8 rutas sin permiso → `/unauthorized`; servidor 403 en escritura de perfil por miembro | — |
| 9 Pruebas | 45 (38–52, media) | No hay E2E de navegación en CI (solo specs unitarios) | Humo Playwright de manifiestos en CI |
| 10 Operabilidad | N/A | — | — |
| 11 UX/idiomas | 60 (52–66, media) | 0 claves sin resolver en 146 vistas; en y pt correctos; 390 px sin scroll horizontal (10/10); estados sin permiso correctos; plan no contratado mal resuelto (clave técnica + «Reintentar»); `payroll/my-payslips` (autoservicio) denegado a miembro | Upsell con nombre comercial; autoservicio de nómina para empleados |
| 12 Competitividad | 40 (32–48, media) | Sin CRM (leads/oportunidades), proyectos, manufactura, consolidación ni portal de clientes en UI frente a Odoo/NetSuite/D365 que los traen | — |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | Cumple en UI existente / **no cumple en cobertura** | dominios sin pantalla |
| 3 AuthZ | Cumple (muestra) | member |
| 5 Humo sin 500/consola | **No cumple** | 0×5xx, pero errores de consola 403 en todas las páginas |
| 11 UI y traducciones | Cumple con reservas | deep links |
| Resto | N/A | — |

## 6. Hallazgos
- **FE-NAV-01** · eje 1/12 · competitividad/funcionalidad · **Alta** · backend `apps/backend/api/src/app/{consolidation,intercompany,manufacturing,projects,…}` sin pantallas. Siete dominios con API (y en algunos casos fichas de auditoría propias) no son usables por un cliente desde el portal: ni ruta en manifiestos ni referencia en cliente. Si se venden, son fachada de cara al usuario. L–XL.
- **FE-NAV-02** · eje 2 · bug · **Media** · `core/guards/settings-modal-redirect.guard.ts:12-13` (= FE-SH-02). S.
- **FE-NAV-03** · eje 2 · bug · **Media** · rutas autenticadas con prefijo de idioma pierden destino (= FE-SH-03). S–M.
- **FE-NAV-04** · eje 11 · UX · **Media** · menú muestra funciones fuera de plan (cobranza IA, predicciones, informe del gerente, anomalías, flujo de caja proyectado, SSO) con mensaje técnico (= FE-SH-05). S.
- **FE-NAV-05** · eje 11 · UX · **Baja** · `payroll/my-payslips` requiere permiso de nómina: un empleado sin rol de nómina no ve sus recibos (comprobado con member → /unauthorized). Verificar con el equipo si el autoservicio debe tener permiso propio. S.
- **FE-NAV-06** · eje 9 · pruebas · **Media** · no hay humo de navegación en CI pese a que el manifiesto lo hace trivial. S.

## 7. Camino mínimo a producción
FE-NAV-02/03 (S) → FE-NAV-04 (S) → humo en CI (S) → decidir alcance comercial: retirar de la oferta los dominios sin pantalla o construirlas (L–XL).

## 8. Camino a 100
Pantallas para CRM/proyectos/manufactura/consolidación/intercompañía (+20), navegación por plan/rol (+6), E2E de navegación por país (+6), deep links probados (+4), autoservicio de empleado (+3).

## 9. Competitividad
Odoo y NetSuite ofrecen CRM, proyectos y manufactura con UI completa; Alegra/Siigo no tienen manufactura pero sí CRM ligero (confianza media).

## 10. Fortalezas
Ninguna página muerta; 0 claves crudas en 3 idiomas; pantalla de acceso denegado correcta y alcanzable; móvil sin desbordes en la muestra.

## 11. No verificado
Rutas con parámetro (36) por URL directa; tenants no DO (secciones condicionadas por país solo vistas en DO); lectores de pantalla; flujos de creación completos (corresponde a cada familia de dominio).
