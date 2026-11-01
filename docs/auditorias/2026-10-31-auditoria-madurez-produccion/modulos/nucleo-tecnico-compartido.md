# Núcleo técnico compartido (T05) — familia F2

> Auditoría 2026-10-31. Diagnóstico sin cambios en el repo. Alcance: `config`, `common`, `shared` (after-commit, idempotency, inbox, numbering/document-sequences, lifecycle, transitions, rate-limit, fiscal-clock, money/parse-decimal), `core`, `contracts`, `database/seeds`.

**Sin hallazgo crítico de seguridad.** Hallazgo alto de corrección monetaria (NUC-01) que afecta a todos los módulos que calculan importes.

## 1. Identificación
- `config/` (4 archivos, 687 LOC, 1 spec): validación Joi del entorno con `devDefault` (obligatorio fuera de dev) y `secret()` (`config/env.validation.ts:40-130,232-260`).
- `common/` (29 archivos, 2.3k LOC, 8 specs): `money.ts`, `parse-decimal.ts`, `dates.ts`, `pagination.ts`, transformadores numéricos/cifrado/blank-to-null, interceptores de archivos, pipes UUID, `loggers/json.logger.ts` (muerto).
- `shared/` (49 archivos, 3.5k LOC, 14 specs): tenancy (ver ficha multitenencia), idempotencia (35 rutas), after-commit, scheduler, jobs (controlador `me/jobs`), document-sequences (controlador), lifecycle (controlador), transitions, rate-limit (sólo IA), fiscal-clock, permisos.
- `contracts/` (25 archivos, 2.1k LOC, 4 specs): puertos entre módulos (ai, approvals, audit, business-events, closing, country-pack, data-transfer, fiscal-records, treasury…).
- `core/` (1 archivo, 45 LOC). `database/seeds/tenant-defaults.ts` (+spec).
- Países: transversal (pero ver NUC-04: lógica DGII en `shared`).

## 2. Estándar de referencia
- (a) Básico: validación fail-fast de configuración; dinero en decimal exacto (string/bigint/decimal lib) con redondeo half-up o half-even explícito por moneda; fechas fiscales en zona horaria de la empresa; paginación obligatoria con límite máximo en todo listado; formato de error único con código estable; idempotencia en operaciones que mueven dinero; numeración sin huecos con bloqueo; `shared` sin dominio. Avanzado: tipos `Money` con moneda incorporada, contratos versionados entre módulos.
- (c) Referencias: Martin Fowler "Money pattern" (confianza alta); IEEE-754 inadecuado para importes — práctica estándar (confianza alta); Stripe API idempotency keys (confianza alta); RFC 7807 problem details (confianza alta).
- (d) Construcción: `Money` value object con `bigint` en unidades menores o `decimal.js`; `Page<T>` uniforme; `shared/kernel` mínimo.

## 3. Resultado
- **Madurez: 50 (44–56, confianza media)** (tope = eje 2) · **Preparación: 58 — No listo** (compuerta crítica 2 no cumple por NUC-01; el resto del núcleo estaría en piloto controlado).
- Eje más débil: Corrección (aritmética en `number`).
- Críticos: 0. Altos: 3.

## 4. Ejes
| Eje | Nota | Evidencia | Falta |
|---|---|---|---|
| 1 Completitud | 62 (55–68, media) | Config, idempotencia, secuencias, lifecycle, contracts reales | Tipo Money |
| 2 Corrección | 50 (42–58, media-alta) | NUC-01 redondeo; `numericTransformerNotNull.from` convierte valores no numéricos en `0` silenciosamente (`common/database/numeric.transformer.ts`); secuencias con `pessimistic_write` (`document-sequences.service.ts:26,64`) | Decimal exacto |
| 3 Multi-país | 55 (45–62, baja) | `minorUnitsFor(currency)` por moneda (`money.ts:128-160`); zona horaria por organización (`fiscal-clock.ts:94`) | Reglas de redondeo por país (verificar con contador local) |
| 4 Arquitectura | 58 (50–65, media) | `contracts/` como puertos: buena dirección; pero `verify:boundaries` FALLA (inventario→contabilidad +2/+2, identidad→contabilidad +1/+1; `logs/verify:boundaries.log`) | Cumplir baseline |
| 5 Higiene | 50 (42–58, media) | `shared` contiene controladores HTTP (`document-sequences`, `lifecycles`, `me/jobs`) y lógica fiscal DGII (NUC-04); `JsonLogger` y `TenantedRepository` muertos | Mover dominio a sus módulos |
| 6 Calidad | 62 (55–68, media) | Comentarios explicativos; ~200 `any` en backend (ENTORNO) | — |
| 7 Robustez | 50 (42–58, media) | Paginación: helper `common/pagination.ts` (MAX 500) adoptado en 14 archivos frente a ≥60 `@Get()` de listado; GET `/inventory`, `/suppliers`, `/taxes` devuelven arrays completos sin paginar | Paginación universal |
| 8 Seguridad | 68 (60–74, media) | Secretos obligatorios fuera de dev; `ENCRYPTION_SECRET` para columnas cifradas; throttler global 20/min por IP (NUC-03) | — |
| 9 Pruebas | 62 (55–68, media) | specs de money, parse-decimal, fiscal-clock, idempotency, after-commit, env.validation | Prueba de casos de redondeo half-up (no detectaron NUC-01) |
| 10 Operabilidad | 55 (48–62, baja) | Config fail-fast | — |
| 11 UX | N/A | — | — |
| 12 Competitividad | N/A | Infraestructura interna | — |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | Cumple | — |
| 2 | **No cumple** (parcial) | NUC-01 redondeo |
| 3 | Cumple | idempotencia por organización |
| 4 | Cumple | whitelist en DTOs (errores `whitelist_validation` observados) |
| 5 | N/A | — |
| 6 | Parcial | redondeo no verificado por país |
| 7 | Parcial | specs no cubren el caso |
| 8 | N/A | — |
| 9 | Cumple | — |
| 10 | Parcial | — |
| 11 | N/A | — |
| 12 | Parcial | — |

## 6. Hallazgos
**NUC-01** — Alta — integridad/corrección — `common/money.ts:77-83` `toCents(amount) = sign * Math.round(|amount*10^scale|)` opera en `number` IEEE-754; el producto `amount*100` ya está desplazado antes de redondear. Reproducido con Node: `toCents(1.005)=100` (esperado 101 half-up), `toCents(0.285)=28` (esperado 29), mientras `toCents(1.115)=112`. Todas las sumas/conversiones (`sumAmounts`, `convert`, `roundToCurrency`) heredan el error de 1 unidad menor en casos .xx5, que es exactamente donde caen impuestos al 18 %/16 %/19 % sobre importes con céntimos. Las columnas `numeric` se materializan como `number` (`numericTransformer`), así que no hay ruta decimal exacta. Forma correcta: redondeo sobre representación decimal (string/`decimal.js`/`bigint` en unidades menores con escala de tasa), o como mínimo `Number(Math.round(Number(amount + 'e' + scale)) + 'e-' + scale)`; tests con tabla de casos .xx5. Impacto: descuadres de 0,01 en impuestos/facturas frente a la autoridad fiscal (verificar con contador local). Esfuerzo: M (el helper es central; L si se migra a decimal en entidades).

**NUC-02** — Alta — robustez — paginación no universal: helper existe pero sólo 14 archivos lo usan; formas de respuesta distintas medidas por API: `/inventory` array, `/suppliers` array, `/taxes` array, `/documents` `{rows,page,pageSize,total,hasMore}`, `/users` `{data,total,page,pageSize}`, `/invoices` `{items,…}`. Listados sin límite cargan catálogos completos (ver BUS-02). Esfuerzo: M.

**NUC-03** — Alta — robustez/UX (transversal) — throttler global `ttl 60000, limit 20` (`app.module.ts:269`) con `ThrottlerGuard` global (`app.module.ts:392`) y tracker por IP: 20 peticiones por minuto por IP para TODA la API. Observado: tras ~20 lecturas seguidas desde la misma IP, `/customers`, `/invoices`, `/journal-entries`, `/chart-of-accounts`, `/audit` → 429 `TOO_MANY_REQUESTS`. Varios usuarios tras el mismo NAT (oficina) comparten el cupo; el SPA hace varias llamadas por pantalla. Matiz: en el recorrido por UI de 77 rutas (2026-10-31 18:36–18:41, ver ficha shell) no se observó ningún 429, mientras que en ráfaga por curl sí; `@nestjs/throttler` compone la clave con clase+manejador, por lo que el cupo efectivo parece ser 20/min por IP **y por ruta** — sigue siendo insuficiente para oficinas tras NAT que consultan la misma lista o hacen polling (confirmado como hallazgo por el coordinador; clave exacta no verificada). Forma correcta: límites por usuario/tenant autenticado (ya existe `TenantRateLimitGuard`, sólo para IA) y límite por IP sólo en rutas anónimas (login, registro). Esfuerzo: S.

**NUC-04** — Media — mezcla de contexto — `shared/fiscal-clock.ts:61-80` (`dgiiDate`, `dgiiTimestamp`, formato e-CF de República Dominicana) y `shared/transitions/remedies.ts` con referencias DGII/NCF: lógica de un país en el núcleo compartido. Forma correcta: mover a `localization/do` o `einvoicing`. Esfuerzo: S.

**NUC-05** — Media — higiene — `shared/` expone 3 controladores HTTP (`document-sequences`, `lifecycles`, `me/jobs`); la numeración de documentos es dominio (facturación/contabilidad), no infraestructura. Esfuerzo: M.

**NUC-06** — Media — `numericTransformerNotNull` convierte `"abc"`/NaN en `0` en lectura y escritura sin error (`common/database/numeric.transformer.ts`): corrupción silenciosa posible. Esfuerzo: S.

**NUC-07** — Baja — formato de error consistente y bueno (`{statusCode, code, messageKey, params, fieldErrors?, timestamp, path}` observado en 400/401/403/404/429/500), sin request id (ver OBS-01).

**NUC-08** — Media — `verify:boundaries` falla en HEAD (regresiones inventario→contabilidad e identidad→contabilidad, entre ellas `organizations/*` importando internos de `chart-of-accounts` y `accounting`): las fronteras declaradas no se respetan.

## 7. Camino mínimo a producción
NUC-03 (S), NUC-01 (M), NUC-02 en listados de maestros (M).

## 8. Camino a 100
Decimal exacto con `Money` (+12, L); paginación universal y `Page<T>` único (+8, M); throttling por principal (+5, S); limpiar `shared` (+6, M); boundaries en verde (+5, M); transformadores estrictos (+3, S).

## 9. Competitividad
N/A (infraestructura). Idempotencia con hash del cuerpo y lock durable de crons están a nivel de buenas prácticas de Stripe/AWS.

## 10. Fortalezas
Config fail-fast con secretos obligatorios; idempotencia `(organization_id,key)` + hash; secuencias con bloqueo; formato de error estable i18n; `contracts/` como puertos.

## 11. No verificado
Semántica gapless de secuencias bajo rollback (otro equipo, facturación); seeds por país en detalle.
Cobertura: ~30 % de archivos leídos; 1 reproducción numérica; 10 llamadas de listado.

<!-- RESUMEN: modulo=nucleo-tecnico-compartido; madurez=50; prep=58; veredicto=No listo; eje_debil=Corrección e integridad; criticos=1; altos=2; camino_min=M -->


## Ajuste de calibración del coordinador (Paso 9)

**NUC-01 se eleva de alta a crítica** (cálculo fiscal incorrecto, transversal): reproducido de forma independiente por el coordinador — `toCents` multiplica en coma flotante antes de redondear (`common/money.ts:77-84`): 1,25 × 18 % = 0,22499… → 0,22 (correcto 0,23); 42,50 × 19 % = 8,075 → 8,07 (correcto 8,08). Afecta a impuestos, totales, e-CF, asientos y POS. La nota (50) y la preparación (58) ya respetan los topes; el veredicto «No listo» se mantiene.
