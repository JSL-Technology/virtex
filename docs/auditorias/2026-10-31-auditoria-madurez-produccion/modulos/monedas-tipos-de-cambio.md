# Ficha T09: Monedas y tipos de cambio (`currencies`)

Familia F3. Fecha: 2026-10-31.

> Sin hallazgos críticos de seguridad. El catálogo global de monedas y el refresco de tasas globales exigen permiso de plataforma (`@RequiresPlatformPermission`, `currencies.controller.ts:24-66`, `exchange-rates.controller.ts:42-60`). Las tasas propias de un tenant quedaron aisladas en la prueba ejecutada: qa-a no ve ni borra una tasa de qa-b (404), y qa-b sí la resuelve.

## 1. Identificación

- **Backend:** `currencies/` tiene 16 archivos y 1 873 LOC, con 2 specs.
- **Tablas:**
  - `currency`: 23 monedas, global.
  - `exchange_rate`: global, con `rate_type` OFFICIAL/MARKET/BUY/SELL, `source` y `date`.
  - `tenant_exchange_rates`: por tenant.
- **Endpoints:**
  - CRUD `/currencies`. Leer requiere solo autenticación; escribir requiere permiso de plataforma.
  - `/exchange-rates`: `update`, `backfill` (plataforma), `POST`, `import`, `history`, `DELETE`, `GET` lookup.
  - Un cron diario a las 3 a. m. con lock (`exchange-rates.service.ts:151`).
- **Componentes:**
  - `ExchangeRateResolver` (`exchange-rate-resolver.service.ts`): directo, inverso, triangulado vía pivote, respaldo de OFFICIAL a MARKET y antigüedad máxima de 10 días al contabilizar (`DEFAULT_MAX_QUOTE_AGE_DAYS`).
  - `XeRatesProvider`: proveedor XE de pago; rechaza las tasas "mock" de la prueba gratuita.
- **Revaluación:** está en `accounting/services/currency-revaluation.service.ts` (otra familia; no auditada aquí).
- **Frontend:** `features/masters/currencies` y `features/masters/exchange-rates` (no recorridas).
- **¿Núcleo?** Sí, para clientes con operaciones en moneda extranjera, que son habituales en DO, AR y VE.

## 2. Estándar de referencia

**Capacidades básicas:**
- Tasas históricas por fecha y tipo.
- Fuente **oficial por país** para efectos fiscales:
  - DO: tasa del BCRD.
  - MX: tipo de cambio FIX que Banxico publica en el DOF, que es el obligatorio para CFDI y contabilidad.
  - CO: TRM de la Superintendencia Financiera / Banco de la República.
  - CL: dólar observado del BCCh.
  - PE: SBS.
  - AR: BNA o BCRA, según el uso.
  - BR: PTAX del BCB.
  - US: no aplica.
- Carga manual e importación.
- Moneda funcional frente a moneda de presentación.
- Revaluación y diferencial cambiario realizado y no realizado.
- Precisión de la tasa en al menos 6 decimales.
- Decimales de la moneda según ISO 4217.

**Cómo lo hacen los líderes** (confianza media):
- Odoo trae proveedores por banco central: Banxico, BCRD vía terceros, Banco de la República y otros.
- CONTPAQi descarga el tipo de cambio del DOF.
- Siigo usa la TRM.

**Invariantes:**
- La tasa usada en un documento queda congelada en él.
- Una tasa fiscal nunca se sustituye en silencio por una de mercado.

## 3. Resultado

- **Madurez: 50** (42–58, confianza media).
- **Preparación: 46, No listo.** La compuerta 6 falla porque no hay fuentes oficiales por país.
- **Eje más débil:** 3.
- **Críticos:** 0. **Altos:** 2.

## 4. Doce ejes

| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad y completitud | 48 (40–55, media) | Hay un único proveedor (XE, de pago). En el entorno no hay credenciales, y `exchange_rate` y `tenant_exchange_rates` están vacías (BD: count = 0). Sin una carga manual, ningún documento en moneda extranjera puede contabilizarse (`GET /exchange-rates?from=USD&to=DOP` → 400 `no_exchange_rate`) | Proveedores oficiales por país, gratuitos y públicos |
| 2 | Corrección | 58 (50–65, media) | `numeric(18,6)`; triangulación; decimales ISO correctos (CLP, PYG y JPY con 0); antigüedad máxima y desviación máxima al contabilizar. **Respaldo silencioso de OFFICIAL a MARKET** (solo deja un `logger.warn`, `exchange-rate-resolver.service.ts:194-203`). Hereda `IMP-01` (redondeo `toCents`) en `convert()` | Que la tasa fiscal sea obligatoria por país, con el respaldo solo si el tenant lo activa |
| 3 | Multi-país | 35 (28–45, media) | Ninguna fuente oficial (ni BCRD, ni Banxico DOF, ni TRM, ni PTAX). `PAB` como moneda de Panamá (en la práctica se opera en USD; verificar). Sin IGTF para VE | Fuentes y reglas de tasa por país |
| 4 | Arquitectura | 65 (58–72, media) | El contrato HTTP de XE está separado de la persistencia; el resolver es único; existe un catálogo ISO | Un puerto `RateSource` con implementaciones por banco central |
| 5 | Higiene | 62 (55–70, baja) | Módulo bien delimitado; `exchange-rate-resolver.testing.ts` es un doble de pruebas | — |
| 6 | Calidad | 68 (60–74, media) | Código y comentarios claros | — |
| 7 | Robustez | 62 (55–70, baja) | Cron con lock y throttle en el refresco; importación por lotes de 500 en una transacción | Reintentos y alerta si no hay tasa del día |
| 8 | Seguridad | 80 (72–85, media) | Permisos de plataforma en lo global; tenant aislado (verificado) | — |
| 9 | Pruebas | 55 (45–62, baja) | 2 specs (proveedor y resolver) | Pruebas de integración de contabilizar con tasa vieja o ausente |
| 10 | Operabilidad | 52 (45–60, baja) | Logs del cron; sin métrica de "tasa faltante" | Alerta y tablero |
| 11 | UX | 50 (40–60, baja) | No recorrida | — |
| 12 | Competitividad | 40 (32–48, media) | Por debajo de Odoo y CONTPAQi en fuentes oficiales | Fuentes oficiales |

## 5. Compuertas

| # | Compuerta | Estado y evidencia |
|---|---|---|
| 1 | Sin fachadas | Parcial: funciona con carga manual; XE no está configurado |
| 2 | Integridad | Cumple: importación todo o nada con upsert por clave natural |
| 3 | Aislamiento | Cumple (verificado) |
| 4 | Validación | Cumple (DTO) |
| 5 | E2E | Cumple en lo probado |
| 6 | Cumplimiento por país | **No cumple**: no hay tasa oficial por país y existe el respaldo silencioso a MARKET |
| 7 | CI | Parcial |
| 8 | Auditoría | Parcial: `recordedByUserId` |
| 9 | Migraciones | Cumple |
| 10 | Observabilidad | Parcial |
| 11 | UI y traducciones | No verificado |
| 12 | Documentación | No cumple |

## 6. Hallazgos

**FX-01 · No hay fuente de tasas oficial por país** · ejes 1 y 3 · multi-país · **Alta**
- **Ubicación:** `currencies/xe-rates.provider.ts` (único proveedor) y `exchange-rates.service.ts:444-446` (escribe `MARKET`).
- **Qué está mal:** México exige el FIX publicado en el DOF para CFDI, contabilidad y el cálculo de la ganancia o pérdida cambiaria. Colombia exige la TRM. La DGII acepta la tasa del BCRD. Sin esas fuentes, el tenant debe cargar las tasas a mano todos los días. Verificar con un contador local.
- **Forma correcta:** implementaciones `RateSource` para Banxico SIE, BCRD, BanRep TRM (datos abiertos), BCCh, SBS y BCB PTAX, guardadas como `OFFICIAL` con su `source`.
- **Esfuerzo:** M.

**FX-02 · Respaldo silencioso de OFFICIAL a MARKET** · eje 2 · integridad · **Alta**
- **Ubicación:** `exchange-rate-resolver.service.ts:194-203`.
- **Qué está mal:** un documento fiscal puede contabilizarse con una tasa de mercado, y la única señal es una línea de log.
- **Forma correcta:** hacerlo configurable por tenant y país, rechazar por defecto en los países con tasa fiscal obligatoria, y guardar en el documento qué tipo de tasa se usó.
- **Esfuerzo:** S.

**FX-03 · Entorno sin tasas: nada en moneda extranjera puede contabilizarse de fábrica** · eje 1 · operabilidad · **Media**
- **Evidencia:** BD con `count(*) = 0` en ambas tablas, y el lookup responde 400.
- **Forma correcta:** sembrar el histórico desde las fuentes oficiales y avisar en el panel.
- **Esfuerzo:** S.

**FX-04 · Moneda de Panamá `PAB`** · eje 3 · **Baja**
- **Ubicación:** `country-profiles.ts:906`.
- **Qué revisar:** la facturación real en Panamá se hace en USD (el balboa es paritario). Verificar con un contador si conviene USD como moneda funcional por defecto.
- **Esfuerzo:** S.

**FX-05 · Moneda funcional resuelta con respaldo `?? 'USD'` en unos 15 servicios** · eje 2 · **Media**
- Ver `LOC-07` en `localizacion-reglas-pais.md`.
- **Esfuerzo:** S.

## 7. Camino mínimo a producción

1. FX-02 (S).
2. FX-01 para DO y MX (M).
3. FX-03 (S).
4. FX-05 (S).

## 8. Camino a 100

| Mejora | Puntos | Esfuerzo |
|---|---|---|
| Fuentes oficiales de los 8 mercados disponibles | +15 | M–L |
| Política de tipo de tasa por país | +6 | S |
| Alertas de tasa faltante | +4 | S |
| Moneda de presentación y conversión de estados (si no la tiene `financial-reporting`; no verificado) | +5 | M |

## 9. Competitividad

**Nota: 40** (32–48, media). Odoo y CONTPAQi descargan las tasas oficiales; aquí la carga es manual o depende de XE de pago.

## 10. Fortalezas

- La resolución de tasas es única y explicada (`explain` devuelve método, origen y fecha de cotización).
- Antigüedad y desviación máximas al contabilizar.
- Decimales ISO correctos por moneda.
- Rechazo explícito de las tasas mock de la prueba gratuita de XE.
- Aislamiento por tenant.

## 11. No verificado

- La revaluación y el diferencial cambiario (`accounting/services/currency-revaluation.service.ts`, de otra familia).
- La llamada real a XE, que no se ejecutó por falta de credenciales y por tener efecto externo con costo.
- La UI.

**Cobertura:**
- Archivos: ~70 %.
- Endpoints ejecutados:
  - `POST /exchange-rates`
  - `GET /exchange-rates`
  - `GET /exchange-rates/history`
  - `DELETE` cruzado entre tenants

<!-- RESUMEN: modulo=monedas-tipos-de-cambio; madurez=50; prep=46; veredicto=No listo; eje_debil=Multi-país y cumplimiento; criticos=0; altos=2; camino_min=M -->
