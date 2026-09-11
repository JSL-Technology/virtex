# Estado del proyecto vs. MVP para República Dominicana

**Proyecto:** Virteex — ERP/POS SaaS multi-inquilino, multi-mercado
**Fecha del informe:** 2026-09-11
**Rama analizada:** `feat/merge-enigma-improvements` (15 commits por delante de `main`)
**Método:** lectura estática del código fuente + ejecución de la suite de pruebas fiscales de la DGII
(`dr-reports.spec.ts`, 11/11 en verde). Donde no se ejecutó algo, se dice explícitamente.

---

## 1. Resumen ejecutivo

**Veredicto:** el producto está **sustancialmente por encima de un MVP** en las dos capas que
definen la viabilidad de un ERP dominicano —**cumplimiento fiscal e-CF (DGII)** y **facturación con
contabilidad de partida doble**— y **por debajo del MVP en un punto operativo concreto y visible:
nómina/TSS no existe**. La navegación del cliente web, que hasta hace pocos commits dejaba el 80 %
del producto invisible tras tarjetas «En construcción», quedó resuelta con un sistema de manifiestos
de módulo. Con Postgres y Redis, la aplicación arranca, se auto-siembra un administrador y un
inquilino real, y el ciclo e-CF completo (construir → validar → firmar → transmitir → conciliar) está
implementado end-to-end.

**Lo que ya cumple, y con holgura:**

- **e-CF / DGII end-to-end.** Todos los tipos de e-NCF (E31, E32, E33, E34, E41, E43, E44, E45, E46,
  E47) y los NCF de transición (B01/B02/B04); semilla + firma + token, transmisión con enrutamiento
  al servicio de **Factura de Consumo** para E32, sondeo de estado, conciliador, aprobación
  comercial, anulación de rangos, idempotencia por `trackId`, código de seguridad y URL de timbre
  (QR). Ver `apps/backend/api/src/app/einvoicing/`.
- **Formatos DGII 606 / 607 / 608 / 609** con cabecera y el conjunto completo de columnas
  (`apps/backend/api/src/app/compliance/reports/dr-reports.ts`; **11 pruebas en verde**).
- **Validación de RNC (9 dígitos) y cédula (11, Luhn) con dígito verificador**
  (`libs/shared/.../localization/fiscal/tax-id-validators.ts`).
- **ITBIS 18 %**, retenciones de ITBIS e ISR modeladas como régimen dominicano
  (`localization/fiscal/withholding-regimes.ts`).
- **Multi-tenencia forzada en base de datos** con Row-Level Security en 79 tablas + `organizationId`.
- **Autenticación endurecida** (Argon2, rotación de JWT, CSRF con cookie `__Host-`, step-up,
  revocación de sesión) — auditoría de 17 hallazgos cerrada.
- **Contabilidad de partida doble** con asientos, cierre de período, plan de cuentas por país.

**Brechas frente a un MVP dominicano (detalle en §6):**

| # | Brecha | Severidad para MVP-RD |
|---|--------|------------------------|
| G1 | **Nómina / TSS-SFS-AFP-INFOTEP**: el módulo HCM son 2 entidades (`department`, `employee`), sin servicio ni controlador. | **Alta** si el segmento objetivo necesita nómina |
| G2 | **Pasarelas de pago locales (Azul, CardNet, tPago)**: solo hay adaptador Stripe, y para el cobro de la *suscripción SaaS*, no para cobros del negocio. | Media (depende de si el POS cobra tarjeta) |
| G3 | **Certificación DGII en ambientes reales (TesteCF/CerteCF)**: el código apunta a los hosts publicados pero **no consta evidencia de una certificación pasada** contra el set de pruebas de la DGII. | **Alta** (bloqueante regulatorio) |
| G4 | **Restos de datos maquetados en el frontend**: el inventario previo halló 8 de 13 páginas de datos maestros con filas fijas; hay que verificar cuáles persisten. | Media |
| G5 | **Verificación no ejecutada en esta sesión** para build/typecheck/e2e completos (solo se corrió la suite fiscal). | Baja (CI la cubre) |

---

## 2. Metodología y alcance

- **Qué se leyó:** estructura del monorepo, 65 módulos de backend, el módulo `einvoicing` completo,
  `compliance`, `invoices`, `localization/fiscal`, los manifiestos de navegación del cliente web,
  `README.md` y los documentos de `docs/`.
- **Qué se ejecutó:** `npx nx test api --testPathPatterns="dr-reports.spec.ts"` → **11/11 pruebas en
  verde** (606, 607, 608, 609). No se ejecutó la suite completa, ni `build`, ni `typecheck`, ni las
  comprobaciones `verify:*` que exigen Postgres/Redis; el pipeline de CI (`.github/workflows/ci.yml`)
  sí las corre con servicios reales.
- **Qué no se cubre:** revisión de seguridad ofensiva, pruebas de carga, y validación jurídica del
  cumplimiento (este informe es técnico, no un dictamen fiscal/legal).

---

## 3. Arquitectura y magnitud

Monorepo **Nx 22** con cuatro aplicaciones y librerías compartidas:

| App | Stack | Puerto | Rol |
|-----|-------|--------|-----|
| `apps/backend/api` | NestJS 11 sobre **Fastify** | 3000 | API del ERP |
| `apps/core/client-web` | **Angular 20** zoneless, standalone, Dockview (pestañas) | 4200 | Portal web |
| `apps/pos` | Angular (app independiente) | 4300 | Punto de venta |
| `apps/desktop` | **Electron 32** | — | Shell de escritorio que envuelve portal + POS |

**Métricas medidas:**

| Métrica | Valor |
|---------|-------|
| Módulos de backend (carpetas en `app/`) | 65 |
| Controladores | 78 |
| Entidades TypeORM | 146 |
| Migraciones | 60 |
| Rutas de navegación declaradas en manifiestos | 93 |
| Archivos de prueba (`*.spec.ts`) backend / frontend | 96 / 127 |
| LOC TS backend (sin specs) | ~93.480 |
| LOC TS frontend (sin specs) | ~38.614 |
| Perfiles de país fiscal | 19 mercados |

**Infra local mínima:** Postgres + Redis. Fuera de producción la API genera sus propios secretos,
trata Stripe/S3/reCAPTCHA como opcionales, y **auto-siembra** `dev@virtex.local / dev12345` con un
inquilino real. En producción el esquema de configuración exige todos los secretos al arrancar.

---

## 4. Estado por capa

### 4.1 Cumplimiento fiscal DR (e-CF / DGII) — el núcleo del MVP dominicano

Es la capa más madura del producto. Reside en `apps/backend/api/src/app/einvoicing/`.

- **Ciclo de vida completo** (`services/ecf-submission.service.ts`): construir XML → validar antes de
  gastar una firma → firmar (XAdES) → transmitir → sondear → conciliar. La fila `ecf_submissions` se
  crea **antes** de que algo pueda fallar, de modo que ningún e-NCF asignado queda invisible, y hay
  ruta de reintento para cada estado (contingencia, pendiente, firmado).
- **Endpoints por ambiente** TesteCF / CerteCF / Producción, con **todas las rutas de servicio
  sobreescribibles por configuración** (`config/dgii-endpoints.ts`): Semilla, ValidarSemilla,
  Recepción, **Recepción FC (consumo)**, Estado, TrackIds, Aprobación Comercial, Anulación de rangos,
  ConsultaTimbre y ConsultaTimbreFC.
- **Enrutamiento por tipo de documento** (`services/dgii-transport.service.ts`): los E32 (consumo por
  debajo del umbral) van al servicio de resumen de Factura de Consumo, no al de recepción ordinaria —
  un detalle que, mal hecho, hace que la DGII rechace todos los E32.
- **Idempotencia**: antes de retransmitir tras un timeout, consulta los `trackIds` ya registrados
  para ese e-NCF y adopta el existente en lugar de duplicar el comprobante.
- **Aprobación comercial** y **anulación de rangos** implementadas (partes obligatorias del ciclo que
  antes estaban configuradas y nunca invocadas).
- **Certificados por régimen** (bóveda de certificados, `certificate-vault.service.ts`), con control
  de vencimiento antes de transmitir.
- **Reloj fiscal por zona horaria del emisor** (`shared/fiscal-clock.ts`): evita el defecto de firmar
  con fecha del día siguiente cuando el servidor está en UTC y la venta es de noche en Santo Domingo.
- **Manejo de moneda extranjera** (`OtraMoneda` con tipo de cambio), descuentos por línea prorrateados
  para que `MontoGravadoTotal × tasa` cuadre con `TotalITBIS`, propina legal y retenciones.
- **QR de timbre y código de seguridad** citando el mismo total que calculó el constructor.

**Formatos periódicos** (`compliance/reports/dr-reports.ts`): 606 (compras), 607 (ventas), 608
(anulados) y 609 (pagos al exterior), con cabecera y el conjunto completo de columnas (24/23 campos),
fechas `AAAAMMDD`, importes con dos decimales. El 606 reporta el impuesto **efectivamente soportado**,
no uno deducido por aritmética inversa del total. **11 pruebas en verde.**

**Numeración fiscal** (`invoices/adapters/dominican-republic-fiscal.adapter.ts`): honra un tipo
solicitado si el inquilino tiene rango para él; si no, emite Crédito Fiscal (E31) cuando el comprador
lleva RNC/cédula **válido** (con dígito verificador) y Consumo (E32) cuando no. Exportaciones (E46),
gubernamental (E45) y regímenes especiales (E44) son alcanzables.

> **Lo que falta para cerrar esta capa:** evidencia de **certificación en TesteCF/CerteCF** contra el
> set de pruebas de la DGII, y credenciales/certificado digital reales de un contribuyente. El código
> está listo; el trámite regulatorio no consta hecho (G3).

### 4.2 Seguridad y multi-tenencia

- **RLS de Postgres** en 79 tablas (`...TenantRowLevelSecurity`) + `organizationId` en cada consulta;
  contexto de tenant por petición. Verificable con `npm run verify:tenancy` y `verify:rls`.
- **Auth** production-grade: Argon2, rotación de refresh, CSRF de doble envío con cookie `__Host-`,
  step-up, revocación de sesión inmediata. Contrato HTTP verificado por `verify:auth-contract`.
- **Cabeceras de seguridad** del bundle (CSP, HSTS, `X-Frame-Options: DENY`, COOP, Permissions-Policy)
  declaradas en `serve.json`.
- **Restricción de origen único**: cookies `SameSite=Lax` + CSRF `__Host-` obligan a servir API y web
  desde el mismo origen (ver `docs/DEPLOYMENT.md`). **Implicación operativa para el despliegue en RD.**

### 4.3 Facturación, ventas y POS

- Facturas, notas de crédito/débito, motor de impuestos de venta (`sales-tax.engine.ts`), resolución
  de retenciones, contabilización de la factura (asiento automático).
- **POS** consolidado: turnos de caja y ventas atómicas que descuentan stock en la misma transacción.
  Existe como **página dentro del portal** (`sales/pos`, tipo CANVAS) **y como aplicación
  independiente** (`apps/pos`, consume `/pos` e `/inventory`).

### 4.4 Inventario, compras, CxC, CxP, tesorería, contabilidad

Módulos vivos y conectados a endpoints reales: `inventory`, `procurement`, `suppliers`,
`accounts-payable`, `customers`/cobros, `treasury`, `reconciliation`, `accounting`,
`journal-entries`, `chart-of-accounts`, `financial-reporting`, `budgets`, `cost-accounting`,
`consolidation`, `intercompany`, `fixed-assets`, `currencies`. El plan de cuentas se aprovisiona por
mercado (19 países) — `verify:markets` lo comprueba.

### 4.5 Frontend, navegación y UX

- **Navegación manifest-driven** (`core/modules/module-manifest.ts` + `manifests/*.manifest.ts`): cada
  módulo se declara **una vez** y de ahí se derivan tabla de rutas Angular, registro de ventanas, menú
  y permisos. Esto **resolvió** el hallazgo del inventario (2026-09-06) donde 40 de 50 enlaces abrían
  «En construcción» sobre páginas ya construidas. Hoy hay **93 rutas** declaradas.
- **Shell de pestañas** estilo VS Code (Dockview): vista previa, pop-out, layout persistente,
  seguimiento de cambios sin guardar (dirty tracking) por `TAB_CONTEXT`.
- **i18n** con auditoría propia (`docs/AUDITORIA_I18N.md`).

### 4.6 Extensiones y escritorio

- **Máquina virtual de extensiones**: marketplace de extensiones firmadas en sandbox `isolated-vm`,
  con pipeline de admisión (OPA `plugin_admission.rego`), consentimiento por inquilino y medición de
  uso. Runtime de UI del lado del cliente ya integrado.
- **Electron** envolviendo portal + POS.

### 4.7 Verificación y CI

`.github/workflows/ci.yml` corre con **Postgres 16 y Redis 7 reales**: `lint`, `test`, `build`,
`typecheck`, más `check:schema-drift`, `verify:fiscal-identity`, `verify:tenancy`, `verify:boot`,
`verify:markets`, `verify:provisioning`, `verify:auth-contract`, `verify:ecf`, `verify:rls`. Todas
re-ejecutables (liberan lo que dejó la ejecución previa).

---

## 5. Requerimientos de un MVP en República Dominicana — matriz de cumplimiento

Requisitos típicos para operar un ERP/facturador en RD (Norma 06-2018 y sucesoras sobre e-CF, Código
Tributario, obligaciones DGII y TSS):

| # | Requerimiento MVP-RD | Estado | Evidencia / nota |
|---|----------------------|--------|------------------|
| R1 | Emisión de e-CF (E31/E32) firmados y transmitidos a la DGII | ✅ Implementado | `einvoicing/services/ecf-submission.service.ts` |
| R2 | Notas de crédito/débito electrónicas (E33/E34) que referencian el documento modificado | ✅ Implementado | `buildContext(...)` → `modifica` |
| R3 | Enrutamiento correcto de Factura de Consumo (servicio de resumen) | ✅ Implementado | `dgii-transport.service.ts` |
| R4 | Aprobación comercial y anulación de rangos | ✅ Implementado | `dgii-transport.service.ts` |
| R5 | Contingencia + conciliación + idempotencia | ✅ Implementado | `ecf-reconciler.service.ts`, `adoptExistingTrackId` |
| R6 | Validación de RNC/cédula con dígito verificador | ✅ Implementado | `tax-id-validators.ts` |
| R7 | ITBIS 18 % y retenciones (ITBIS/ISR) | ✅ Implementado | `withholding-regimes.ts`, `sales-tax.engine.ts` |
| R8 | Formatos DGII 606/607/608/609 | ✅ Implementado + probado | `dr-reports.ts` (11 pruebas) |
| R9 | Representación impresa con QR de timbre y código de seguridad | ✅ Implementado | `buildQrUrl(...)`, `invoice-renderer.service.ts` |
| R10 | Multi-empresa aislada (un contador con varios RNC) | ✅ Implementado | RLS + `organizationId` |
| R11 | Contabilidad de partida doble y cierre de período | ✅ Implementado | `accounting`, `journal-entries` |
| R12 | Inventario, compras, CxC/CxP, tesorería | ✅ Implementado | módulos vivos |
| R13 | POS con turnos de caja y descuento de stock atómico | ✅ Implementado | `apps/pos`, `pos` module |
| R14 | Navegación usable (sin páginas «En construcción» sobre features reales) | ✅ Resuelto | manifiestos de módulo |
| R15 | **Certificación DGII en TesteCF/CerteCF con certificado real** | ⚠️ **Pendiente** | código listo; trámite no consta |
| R16 | **Nómina con TSS (SFS/AFP/INFOTEP) e ISR de asalariados** | ❌ **No implementado** | HCM = 2 entidades, sin servicio |
| R17 | **Cobro electrónico local (Azul/CardNet/tPago)** para el POS/e-commerce | ❌ No implementado | solo Stripe para suscripción SaaS |
| R18 | Datos maestros sin filas maquetadas | ⚠️ Verificar | inventario halló 8/13 con filas fijas |

---

## 6. Análisis de brechas priorizadas

### G1 — Nómina / TSS (severidad ALTA condicional)
El módulo `hcm` tiene solo `department.entity.ts` y `employee.entity.ts`; **no hay servicio ni
controlador**, ni cálculo de SFS, AFP, INFOTEP, ISR de asalariados, ni archivos de autodeterminación
de la TSS. Para el segmento de PYME dominicana que espera «facturación + nómina» en un solo sistema,
esto es un faltante visible. **Decisión de producto:** ¿el MVP incluye nómina o se pospone? Si se
incluye, es el mayor esfuerzo pendiente (estimación gruesa: 4–8 semanas para un núcleo TSS + volante
de pago + reporte).

### G2 — Cobro electrónico local (severidad MEDIA)
El único adaptador de pago es **Stripe**, y su propósito es cobrar la **suscripción al SaaS**, no los
cobros del negocio del cliente. Para un POS que acepte tarjeta en RD hace falta integrar **Azul**,
**CardNet** o **tPago**. Si el MVP se limita a efectivo/transferencia registrados manualmente, esta
brecha no bloquea; si el POS debe capturar tarjeta, sí.

### G3 — Certificación DGII (severidad ALTA, bloqueante regulatorio)
El código apunta a los hosts oficiales y contempla los tres ambientes, pero **no consta que se haya
completado la certificación en TesteCF/CerteCF** con un certificado digital real de contribuyente.
Sin ese sello, no se puede emitir en Producción legalmente. **Acción:** conseguir certificado digital
de un emisor piloto y ejecutar el set de pruebas de la DGII contra `verify:ecf` apuntando a TesteCF.

### G4 — Restos maquetados en frontend (severidad MEDIA)
El inventario de 2026-09-06 halló 8 de 13 páginas de datos maestros con filas fijas. Varias se
reescribieron desde entonces (manifiestos, gestos de lista). **Acción:** barrido dirigido de
`apps/core/client-web/src/app/features` buscando datos en duro fuera de specs antes del lanzamiento.

### G5 — Verificación completa no ejecutada aquí (severidad BAJA)
En esta sesión solo se corrió la suite fiscal (verde). El resto (`build`, `typecheck`, `verify:*`)
lo cubre CI, pero conviene una corrida verde completa fijada como criterio de release.

---

## 7. Fuera de alcance / decisiones de producto abiertas

- **Nómina/TSS** (ver G1) — decisión de si entra al MVP.
- **App móvil nativa** — hoy hay web + Electron; no hay app móvil.
- **Facturación recurrente / suscripciones del cliente final** — el motor de billing existe para el
  SaaS, no como producto para el inquilino.
- **Integración bancaria automática (open banking DR)** — la conciliación es por importación de
  extractos, no por conexión directa.

---

## 8. Roadmap recomendado a MVP-RD

**Fase 0 — Cierre regulatorio (bloqueante, 1–2 semanas)**
- [ ] Certificado digital real de emisor piloto.
- [ ] Certificación en TesteCF → CerteCF (set de pruebas DGII) vía `verify:ecf`.
- [ ] Corrida verde completa de CI como criterio de release (G5).
- **Criterio de salida:** un e-CF real aceptado por la DGII en CerteCF.

**Fase 1 — Pulido operativo (2–3 semanas)**
- [ ] Barrido de datos maquetados en frontend (G4).
- [ ] Verificar representación impresa (PDF con QR) contra un lector de timbre real.
- [ ] Endurecer despliegue de origen único (proxy inverso API + web) — `docs/DEPLOYMENT.md`.
- **Criterio de salida:** un inquilino piloto factura, cobra e imprime sin tocar datos falsos.

**Fase 2 — Cobro local, si el POS lo exige (2–4 semanas)**
- [ ] Adaptador Azul/CardNet detrás de `PaymentGateway` (interfaz ya existe).
- **Criterio de salida:** una venta de POS cobrada con tarjeta local y conciliada.

**Fase 3 — Nómina/TSS, si entra al MVP (4–8 semanas)**
- [ ] Núcleo de nómina: devengos, SFS/AFP/INFOTEP, ISR de asalariados, volante de pago.
- [ ] Archivos de autodeterminación TSS.
- **Criterio de salida:** una nómina mensual calculada y su archivo TSS generado.

---

## 9. Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Certificación DGII toma más de lo previsto | Bloquea lanzamiento | Empezar Fase 0 ya; el código no es el cuello de botella |
| Cambios normativos DGII (versiones de esquema) | Rechazos en Producción | Endpoints y rutas ya son configurables sin recompilar |
| Expectativa de nómina no cubierta | Rechazo comercial en PYME | Definir alcance MVP explícitamente con el cliente |
| Despliegue en dos orígenes distintos | 403 en todo lo que cambia estado | Documentado; exige proxy de origen único |

---

## 10. Conclusión

Virteex **no es un prototipo**: es un ERP multi-inquilino con una implementación de facturación
electrónica dominicana más completa y más correcta que la de muchos productos ya en el mercado local,
respaldada por multi-tenencia forzada en base de datos, autenticación endurecida y un pipeline de CI
que ejerce el sistema real. Para declarar «MVP listo para República Dominicana» faltan **tres cosas
concretas y acotadas**: (1) **certificar** el e-CF ante la DGII con un certificado real, (2) decidir y,
si aplica, **construir nómina/TSS**, y (3) un **pulido de datos maquetados** en el frontend. La
primera es un trámite sobre código ya listo; la segunda es una decisión de alcance; la tercera es
higiene de lanzamiento. Ninguna es una reescritura.
