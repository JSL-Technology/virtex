# Ficha: `einvoicing` (DGII e-CF y regímenes CFDI, DIAN, SUNAT, SRI, SII, NF-e, AFIP) — familia FAC

⚠️ CRÍTICO: FAC-EINV-01 — los regímenes de factura electrónica de MX, CO, PE, EC, CL, BR y AR existen como código (constructores, adaptadores, transporte) pero **no están conectados a ningún flujo**: ninguna factura de esos países se construye, firma ni transmite.

## 1. Identificación
- **Backend:** `apps/backend/api/src/app/einvoicing/` (≈12.150 líneas). DO: `services/ecf-xml-builder.service.ts` (514), `ecf-validator.service.ts` (314), `ecf-signer.service.ts`, `ecf-submission.service.ts` (585), `ecf-lifecycle.service.ts` (345: aprobación comercial, anulación de rangos ANECF), `ecf-reconciler.service.ts` (cron 5/10 min con `SchedulerLockService`), `dgii-auth.service.ts`, `dgii-transport.service.ts`, `dgii-config.service.ts`, `certificate-vault/inspector/trust`, `fiscal-range.service.ts` (343), `fiscal-regime-settings.service.ts`. Regímenes: `regimes/{mx,co,pe,ec,cl,br,ar}/*.builder.ts|*.adapter.ts`, `regime-transport.service.ts`, `fiscal-regime.registry.ts` (3.815 líneas).
- **Endpoints:** `einvoicing.controller.ts`: `POST/GET/DELETE certificates`, `GET invoices/:id/status`, `POST invoices/:id/submit`, `GET invoices/:id/xml`, `POST received/approval`, `POST sequences/void`, `GET messages`; `fiscal-regime-settings.controller.ts`: `GET/PUT regime/settings`, `GET/POST/DELETE regime/ranges`.
- **Pruebas:** 14 specs (constructores por régimen, adaptadores, validador, firma, lifecycle XML); `certificate-trust.spec.ts` **no compila** (TS2345 node-forge) → `api:typecheck` en rojo. Scripts `verify:ecf` (32 checks, sin red) y `verify:invoicing` (54 checks).
- **Países:** DO operativo; MX/CO/PE/EC/CL/BR/AR declarados (catálogos, certificados, rangos) sin pipeline. **Núcleo:** sí en DO (e-CF obligatoria por fases, Ley 32-23 — verificar con contador local) y en todos los países con factura electrónica obligatoria.

## 2. Estándar de referencia
- (a) Básicas: construcción XML conforme a XSD oficial, firma XAdES/XMLDSig con certificado del contribuyente, envío y consulta de estado (TrackId), contingencia, reintentos, recepción de e-CF de proveedores y aprobación comercial, anulación de rangos, representación impresa con QR/timbre, ambientes de prueba/certificación/producción por tenant, custodia cifrada de certificados. Fuera de DO: integración con PAC (MX), proveedor tecnológico o directa DIAN (CO, SOAP WS-Security + ZIP), OSE/SUNAT (PE), SRI offline (EC), SII (CL, CAF), SEFAZ (BR), AFIP WSFE (AR).
- (b) Invariantes: número fiscal consumido ⇒ documento transmitido o en contingencia registrada; ninguna transmisión real desde entornos de prueba; el certificado nunca sale en claro.
- (c) Líderes: proveedores certificados DGII (p.ej. listados por DGII como "proveedores de servicios e-CF"), Alegra, Siigo (DIAN), CONTPAQi/Facturama (PAC SAT), Defontana/Bsale (SII) — confianza media (conocimiento previo; no verificado con WebFetch en esta sesión).
- (d) Construcción: puerto `FiscalRegime` por país con builder/signer/transport, outbox transaccional, cola con reintentos y estado por documento; configuración de endpoint/credencial **por tenant**.

## 3. Resultado
- **Madurez: 40 (32–48, confianza media)** — DO sólido en construcción/validación/firma; resto de regímenes desconectado (crítico).
- **Preparación comercial: 35. Veredicto: No listo** global; **DO: piloto controlado** condicionado a FAC-EINV-02/03 y a certificación DGII real (no verificada).
- Eje más débil: 1 (autenticidad) por regímenes no conectados.
- Críticos abiertos: **FAC-EINV-01**.

### Pruebas ejecutadas
- `npm run verify:ecf` contra `virteex_test`: **EXIT 0, 32 ✓** ("EL e-CF SE CONSTRUYE, VALIDA Y FIRMA CONFORME AL FORMATO DE LA DGII"), incluye zona horaria del contribuyente y fin de mes.
- `npm run verify:invoicing` contra `virteex_test`: **EXIT 0, 54 ✓, 0 ✗** (borrador sin NCF, bloqueo sin certificado, E31 con vencimiento, envío PENDING, NC E34, sin e-NCF duplicado, Colombia exige certificado ligado al NIT). **Pero el log muestra 3 veces** `[DgiiAuthService] Fallo al validar la semilla firmada ante la DGII: HTTP 400`: el script **pidió una semilla a la DGII real y envió la semilla firmada** (FAC-EINV-02). No se emitió ningún e-CF aceptado (la DGII rechazó el certificado de prueba), pero hubo contacto externo.
- En la API `erp` **no emití tipos E** (sin certificado la emisión se bloquea; con certificado transmitiría a CerteCF/TesteCF) → "no probada por riesgo de efecto externo".
- `GET /invoices/context` MX: tipos `I`,`E` electrónicos, `blockedBy: no_certificate`; CO: `01`,`91`, `blockedBy: no_range`. Es decir, la UI anuncia CFDI/DIAN como disponibles tras subir certificado/rango.
- Aislamiento: `GET /einvoicing/invoices/<factura de qa-do-a>/status` desde qa-do-b → 200 `null` (no expone datos).

## 4. Ejes
| # | Nota | Evidencia clave | Qué falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 30 (22–38, alta) | DO real (XML, validador, firma, transporte, reconciliador, aprobación comercial, ANECF). `FiscalRegimeRegistry` solo aparece como provider/export en `einvoicing.module.ts:30,94,105`; `grep -rn "FiscalRegimeRegistry\|CfdiRegimeAdapter\|DianRegimeAdapter\|RegimeTransportService\|PacProvider"` fuera del módulo/regímenes → **0 consumidores**. `EcfSubmissionService.submitInvoice` exige e-NCF dominicano (`isElectronicFiscalDocument` = `/^E\d{12}$/`). | Conectar cada régimen a emisión (outbox) o declararlos no soportados. |
| 2 Corrección | 55 (45–62, media) | DO: validación previa al consumo de e-NCF, reintentos con `MAX_CONTINGENCY_ATTEMPTS`, registro de envío dentro de la transacción de emisión (`registerPending`). Dos tablas de rangos con reglas distintas: DO en `ncf_sequences` (compliance) y resto en `fiscal_document_ranges` (einvoicing). | Una sola fuente de rangos. |
| 3 Multi-país | 25 (18–32, media) | Regímenes no conectados; `RegimeTransportService.configurationFor` lee `EINVOICE_<PAÍS>_ENDPOINT/TOKEN` **del proceso** (`regime-transport.service.ts:33-47`) — una credencial para todos los tenants, contradice su propio comentario ("vienen de la configuración del tenant"); DIAN se enviaría como `POST application/xml` crudo (`co/dian.adapter.ts:109`), no el SOAP/ZIP que exige la DIAN (verificar con proveedor). DO: ambiente por tenant (`dgii-config.service.ts:37-47`). | Configuración por tenant; protocolos oficiales; homologación. |
| 4 Arquitectura | 55 (45–62, media) | Buen diseño de puerto por régimen y outbox en DO; registro y adaptadores sin uso. | Integrar o eliminar. |
| 5 Higiene | 50 (40–58, media) | 14 violaciones de frontera; registra entidades `Organization/OrganizationSettings` ajenas (`einvoicing.module.ts:50`). | — |
| 6 Calidad | 45 (38–52, media) | 13 archivos con avisos de lint; spec que no compila (typecheck rojo); `node-forge ≤1.4.0` con vulnerabilidad alta de verificación de firmas (npm audit) usado en certificados. | Actualizar node-forge; arreglar spec. |
| 7 Robustez | 60 (50–68, media) | Timeout HTTP configurable (30 s), cron con lock, contingencia; transmisión fuera de la request. | Backoff exponencial explícito. |
| 8 Seguridad | 55 (45–62, media) | Certificados cifrados AES-256-GCM (`ECF_CERT_ENCRYPTION_KEY`), endpoints con permisos (`settings:edit_company`, `invoices:void`). `ECF_ALLOW_TEST_CERTIFICATES` existe (lo activa el script). Status de documento ajeno → 200 null en vez de 404. | — |
| 9 Pruebas | 50 (40–58, media) | Specs de builders por país (prueban XML que nunca se usa); verify:ecf sólido; spec rota; verify:invoicing con red externa. | Integración DO con transporte simulado inyectado; quitar red. |
| 10 Operabilidad | 50 (40–58, baja) | Errores DGII logueados con contexto; `GET messages` lista intercambios. | Panel de estado por documento/tenant con alertas. |
| 11 UX | 45 (35–55, baja) | Contexto expone `blockedBy` claros; UI no probada. | — |
| 12 Competitividad | 35 (25–45, media) | DO cercano a un proveedor e-CF básico; en MX/CO/PE/CL/BR/AR inexistente frente a líderes locales. | — |

Madurez 40 vs promedio ≈46: tope por crítico y eje 1.

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 Sin fachadas | **No cumple** | Regímenes no conectados presentados en el contexto como emitibles. |
| 2 Integridad | Cumple en DO | outbox + validación previa. |
| 3 AuthZ/aislamiento | Cumple parcial | permisos; status ajeno 200 null. |
| 4 Validación | Cumple DO | validador contra formato DGII. |
| 5 Humo | No probado (riesgo externo) | — |
| 6 Cumplimiento | **No cumple** | 7 regímenes sin pipeline. |
| 7 Pruebas CI | **No cumple** | typecheck rojo; verify:invoicing contacta DGII. |
| 8 Auditoría | Parcial | mensajes registrados. |
| 9–12 | Global/Parcial | — |

## 6. Hallazgos
- **⚠️ FAC-EINV-01** — einvoicing / ejes 1, 3 — funcionalidad falsa — **Crítica** — `einvoicing/regimes/**`, `einvoicing.module.ts:30-38,94,105` — Siete regímenes (CFDI, DIAN, SUNAT, SRI, SII, NF-e, AFIP) con builders/adaptadores/transporte que nadie invoca. Una factura MX/CO/… emitida tras subir certificado o rango obtiene número y nunca se timbra/transmite; el contexto los muestra como tipos electrónicos disponibles. **Forma correcta:** conectar `FiscalRegimeRegistry` al outbox de emisión con estado por documento y configuración por tenant, o declarar los países "facturación electrónica no soportada" y bloquear. **Impacto:** bloquea la venta en esos 7 países. **Esfuerzo:** XL.
- **FAC-EINV-02** — einvoicing / ejes 9, 8 — seguridad operativa — **Alta** — `dgii-config.service.ts:37-47`, `dgii-endpoints.ts:43-45`, `tools/verify/invoicing-lifecycle.ts` — No hay modo "sin transmisión": en `NODE_ENV=test/development` el destino por defecto es CerteCF (`processValue ?? 'CerteCF'`) y la prueba de CI llama a `ecf.dgii.gov.do` (log: 3× "Fallo al validar la semilla firmada ante la DGII: HTTP 400"). Forma correcta: transporte nulo por defecto fuera de producción, opt-in explícito, y CI sin red externa. M.
- **FAC-EINV-03** — ejes 6, 8 — seguridad — **Alta** — dependencia `node-forge ≤1.4.0` (npm audit high: verificación RSA PKCS#1 v1.5 acepta DigestAlgorithm anidado) usada por `certificate-inspector/trust`; además `certificate-trust.spec.ts:25` no compila. S.
- **FAC-EINV-04** — eje 3 — multi-país/arquitectura — **Alta** — `regimes/regime-transport.service.ts:33-47` — endpoint y credencial por proceso, no por tenant (un SaaS con varios emisores en MX/CO no puede tener credenciales distintas). M.
- **FAC-EINV-05** — eje 2/4 — arquitectura — **Media** — dos modelos de rango (`ncf_sequences` vs `fiscal_document_ranges`) con validaciones duplicadas (`compliance.service.ts:200-300` vs `fiscal-range.service.ts`). M.
- **FAC-EINV-06** — eje 8 — **Baja** — `GET /einvoicing/invoices/:id/status` de otro tenant → 200 `null` en lugar de 404. S.

## 7. Camino mínimo a producción
DO: FAC-EINV-02 (M) → FAC-EINV-03 (S) → certificación DGII real con un contribuyente piloto (no verificable aquí) → panel de estado (M). Resto: decidir por país — declarar no soportado ya (S) y luego conectar régimen + homologación por país (XL cada uno). Retocar DO; rehacer integración de regímenes.

## 8. Camino a 100
Conectar regímenes con outbox (+25, XL) → credenciales por tenant (+8, M) → protocolos oficiales/homologación por país (+10, XL) → transporte nulo en pruebas (+4, M) → monitoreo (+4, M).

## 9. Competitividad
DO: paridad básica con proveedores e-CF (aprobación comercial y ANECF son un plus). Fuera de DO: brecha básica (bloquea). Fuentes: conocimiento previo de PAC SAT, DIAN, SII (confianza media).

## 10. Fortalezas
Validación antes de consumir e-NCF; outbox transaccional; ambiente DGII por tenant; custodia cifrada de certificados; verify:ecf ejecutable y completo; builders por país bien probados (base reutilizable).

## 11. No verificado
Emisión E31/E32 en `erp` y aceptación DGII (riesgo externo); conformidad XSD de los builders no-DO frente a anexos oficiales; UI de certificados/rangos.
