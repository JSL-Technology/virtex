# 00 — Resumen ejecutivo

Auditoría de madurez, construcción y preparación para producción de Virteex ERP. Commit `36f10d79` (rama `ccr-f710ff5b-8ijix4`, idéntica a `main`), 2026-11-07/08. Es solo diagnóstico: no se modificó código, configuración ni datos del repositorio. Las únicas escrituras fueron este informe y datos `QA-` en la base local. Ver incidencias en `09` §5.

## Resumen (15 líneas)

1. **Veredicto del producto: No listo para producción en ningún país.** Preparación del núcleo: DO 48, US 38, MX/CO/CL/PE/AR/EC 30, BR 20, UY…NI 22 (`05`). **Madurez del producto ≈ 46/100** (40–52, confianza media). Es un juicio sobre el núcleo, no un promedio.
2. Hay ingeniería de verdad:
   - autorización única con denegación por defecto (808 handlers sin hueco);
   - RLS con verificadores, y en producción el arranque se niega a correr como superusuario;
   - 3.535 pruebas que pasan contra Postgres real;
   - 178 migraciones reproducibles sin deriva;
   - partida doble, inmutabilidad, períodos cerrados e idempotencia verificados en vivo, sin sobreventa ni doble cobro con 20 operaciones concurrentes.
3. **Diez hallazgos críticos abiertos, todos re-verificados** (tabla abajo). Uno de seguridad: escritura entre tenants. Nueve de corrección: fiscal, contable, multimoneda, KPI y funciones presentadas como reales que no existen.
4. **`main` está en rojo desde el 2026-10-13 y se sigue fusionando**: typecheck y 3 suites del api, 15 de los últimos 24 runs. Las pruebas de los dos últimos arreglos de seguridad nunca pasaron. CI contacta el servicio real de la DGII en cada push.
5. **Multi-país mayormente nominal.**
   - Solo DO tiene una cadena fiscal conectada.
   - Los adaptadores CFDI, DIAN, SUNAT, SRI, SII, NF-e y AFIP existen sin consumidor, y Brasil factura al 0 %.
   - Los diez mercados genéricos emiten facturas no fiscales sin avisar.
   - Las reglas son constantes en código, sin vigencia, y lo dominicano se filtra a los planes de cuentas del resto.
6. **DO tampoco está listo**: el 607/608 da 500, las NC fallan con el cupo agotado, los cobros en USD se aplican 1:1 contra facturas en DOP y la revaluación cambiaria nunca corre. La nómina tiene dos posibles errores de cotización TSS, a confirmar con un contador.
7. **Patrón dominante: "construido pero no conectado"** (SP-01): estados comparativos, listas de precios, revaluación, consolidación, landed cost, manufactura y `/metrics`. Seis backends no tienen pantalla.
8. El servidor **confía en valores derivados que envía el cliente** (ITBIS de compra, contravalor, retenciones, deducciones negativas) y deja salir errores de dominio como 500 (SP-04, SP-05).
9. Operación: hay logs con correlación, pero no métricas ni alertas utilizables, ni respaldo con restauración probada, ni releases. Los adjuntos van a disco local por defecto en producción. La importación es síncrona y de hasta 5.000 filas, insuficiente para migrar un cliente mediano.
10. Fronteras de módulo: 1.237 violaciones, 14 ciclos y 108 transacciones que cruzan módulos. Hay dos motores de flujo con aprobaciones solapadas.
11. Frente al informe del 2026-10-31 (madurez ≈38) hay mejora real con 43 commits: aislamiento por referencias, GL-01, concurrencia, identidad y firma de extensiones. Pero tres arreglos declarados no se sostienen (607, Brasil, cadena e-CF) y CI empeoró (`09` §6).
12. Ningún módulo es "Listo para producción". "Listo con reservas" en 8 componentes de plataforma, encabezados por identidad y permisos. Piloto controlado en 27. **No listo** en 35 (más `shared-backend`, sin veredicto propio por no ser vendible por sí mismo).
13. **Camino mínimo**: Fase 0 de proceso (CI verde obligatorio, interruptor de efectos externos, respaldo; S–M) y Fase 1 de 16 correcciones del núcleo (S–M cada una). Con eso DO llega a **piloto controlado**. Abrir MX o CO exige rehacer el motor de reglas por país como datos versionados (L) y conectar la e-factura (XL).
14. **Recomendación comercial**: no vender hoy. Tras las fases 0 y 1, piloto acompañado solo en DO, solo moneda base y sin consolidación. Retirar del menú los esqueletos y declarar "solo contabilidad, sin documento fiscal" donde no hay régimen.
15. Confianza: alta en lo ejecutado. Media-baja en competitividad (pocas fuentes web) y en los módulos bloqueados por el plan Starter (collections, consolidation, intercompany). Lo normativo queda **"verificar con contador/abogado local"**.

## Hallazgos críticos (reportados al inicio)

| ID | Qué | Dónde | Verificación |
|---|---|---|---|
| **PLT-NOT-01** | **Escritura entre tenants**: un usuario se apropia de la suscripción push de otro tenant enviando su `id`; además el `endpoint` no se valida (posible SSRF) | `push-notifications.controller.ts:22-31`; tabla `push_subscription` sin `organization_id` ni RLS | Explotado en vivo (PLTA); código y BD (coordinador) |
| FAC-CMP-01 (= INV-01) | 607 y 608 → 500 en todo tenant DO; las ventas POS con NCF nunca se declaran | `compliance.service.ts:432-436` (`created_at` vs `"createdAt"`) | Vivo + código |
| FAC-INV-01 | Notas de crédito y anulaciones → 500 cuando se agota el cupo del plan (la transacción queda abortada) | `invoices.service.ts:473`; `saas/repositories/usage-metric.repository.ts:64-108` | Vivo + código |
| TES-01 | Cobro en USD aplicado 1:1 contra factura en DOP, con ganancia cambiaria ficticia (12.200 en la prueba) | `customer-payments.service.ts:299-352`; UI `form.page.ts:223-230` | Vivo + código |
| FINB-01 | La revaluación cambiaria nunca se ejecuta (0 cuentas con moneda; la API no deja asignarla) y el cierre la da por hecha | `create-account.dto.ts`; `currency-revaluation.service.ts:112-133`; `closing-automation.service.ts:90` | Vivo + BD + código |
| LOC-01 | Brasil (`available`) factura con impuesto 0 sin bloqueo | `tenant-jurisdiction.provider.ts:69-79`; `invoices.service.ts:583` | Vivo + código |
| FAC-EINV-01 | CFDI, DIAN, SUNAT, SRI, SII, NF-e y AFIP sin consumidor, pero presentados como electrónicos | `einvoicing.module.ts`; `/invoices/context` | Código |
| FAC-PL-01 | Las listas de precios no se aplican en ningún documento | `price-lists/` sin consumidores | Código |
| FINB-30 | La consolidación infla activo y patrimonio (la eliminación inversión–patrimonio es solo informativa) | `consolidation.service.ts:442-452, 795-824` | Código (no ejecutable por el plan) |
| IA-B01 | El KPI "EBITDA" muestra la utilidad neta | `dashboard.service.ts:183-197` | Vivo + código |

## Panel de control

Notas 1–100, calibradas por el coordinador (`09` §3). El rango y la confianza de cada nota están en su ficha. Columnas:

- **Crít.**: hallazgos críticos abiertos en el módulo.
- **Camino**: esfuerzo del camino mínimo a producción.
- **Veredicto**: LR = listo con reservas, PC = piloto controlado, NL = no listo.

| Módulo | Madurez | Prep. | Veredicto | Eje más débil | Crít. | Camino |
|---|---|---|---|---|---|---|
| auth | 83 | 82 | LR | 6 calidad / 9 CI | 0 | M |
| roles-permisos | 82 | 80 | LR | 6 | 0 | M |
| security-onboarding | 82 / 74 | 78 | LR | 8 / 11 | 0 | S–M |
| users | 81 | 80 | LR | 10 auditoría | 0 | S |
| extensions | 74 | 72 | LR | 7 / 10 | 0 | S |
| organizations | 72 | 70 | LR | 10 auditoría | 0 | S |
| multi-tenencia | 70 | 72 | LR (condicionado) | 8 | 0 (afectado por PLT-NOT-01) | M |
| relationship-map | 70 | 68 | PC | 7 | 0 | S |
| datasheets | 68 | 66 | PC | 4 validación | 0 | S–M |
| journal-entries | 66 | 64 | PC | 2 multimoneda | 0 | S–M |
| config-database | 66 | 65 | PC | 7 migraciones | 0 | M |
| i18n | 66 | 64 | PC | 3 terminología | 0 | S–M |
| libs-shared | 66 | 68 | LR | 5 | 0 | S |
| workflow-engine | 62 | 60 | PC | 4 dos motores / 9 | 0 | L |
| financial-reporting | 62 | 58 | PC | 12 comparativos | 0 | S–M |
| queues-cache-jobs | 62 | 60 | PC | 10 | 0 | S |
| ai-engine | 62 | 55 | PC | 1 / 12 | 0 | M |
| procurement | 60 | 60 | PC | 1 / 12 | 0 | M |
| settings | 60 | 60 | PC | 10 | 0 | S–M |
| my-work | 60 | 60 | PC | 9 / 12 | 0 | S |
| accounts-payable | 58 | 62 | PC (DO) | 2 | 0 | M |
| audit | 58 | 60 | PC | 1 / 10 cobertura | 0 | M |
| ai | 58 | 52 | PC | 11 / 9 | 0 | M |
| desktop | 58 | 50 | PC | 8 cadena de suministro | 0 | M–L |
| accounting | 57 | 55 | PC (AR/VE: NL) | 2 | 0 | M |
| frontend-shell | 56 | 55 | PC | 5 | 0 | L |
| mail-inbound-mail | 56 | 58 | PC | 10 | 0 | M |
| workflows | 55 | 55 | PC | 2 concurrencia | 0 | S |
| treasury | 55 | 56 | PC (solo moneda base) | 2 | 0 | S |
| storage-documents | 55 | 55 | PC | 7 / 8 | 0 | S–M |
| shared-backend | 55 | N/A | — | 5 | 0 | L |
| pos | 55 | 45 | NL | 3 | 1 (607) | M–L |
| invoices | 55 | 50 | NL | 3 | 1 | M |
| saas-payment | 55 | 50 | NL | 2 | 1 (raíz FAC-INV-01) | M |
| inventory | 52 | 48 | NL | 1 / 12 | 0 | L |
| reconciliation | 52 | 52 | PC | 7 | 0 | M |
| dimensions | 52 | 50 | PC | 2 | 0 | S–M |
| navegacion-y-cobertura-ux | 52 | 50 | PC | 1 / 12 | 0 | L–XL |
| search | 50 | 48 | PC | 1 / 12 | 0 | M |
| fixed-assets | 50 | 45 | NL | 1 / 12 | 0 | M |
| observabilidad | 50 | 48 | PC | 10 métricas | 0 | S–M |
| legal | 50 | 50 | NL | 1 / 2 | 0 | M |
| customers | 48 | 50 | NL | 2 | 1 | S–M |
| chart-of-accounts | 45 | 42 | NL | 3 | 0 | M (L en MX/CO/PE) |
| currencies | 45 | 40 | NL | 1 | 1 | M + L |
| sales | 45 | 40 | NL | 1 | 0 | L |
| hcm | 45 | 38 | NL | 1 | 0 | M–L |
| notificaciones-push-websockets | 45 | 45 | NL | 8 | 1 | S |
| documentacion-gobernanza | 45 | 40 | NL | 10 | 0 | M |
| payroll | 42 | 40 (DO) | NL | 3 / 2 | 0 (2 altos, posibles críticos) | L–XL |
| budgets | 42 | 38 | NL | 2 | 0 | M + L |
| localization | 42 | 38 | NL | 3 | 1 | M–L |
| data-transfer | 42 | 42 | NL | 2 | 0 | M–L |
| einvoicing | 40 | 35 | NL (DO: PC condicionado) | 1 | 1 | DO M; resto XL |
| suppliers | 40 | 40 | NL | 1 / 2 | 0 | M |
| jurisdictions-geo | 40 | 35 | NL fuera de DO | 3 | 0 | S + L |
| bi-dashboard-overview-reports | 40 | 38 | NL | 2 | 1 | M |
| compliance | 38 | 30 | NL | 2 | 1 | S (crítico) / M |
| taxes | 35 | 30 | NL | 2 / 3 | 0 | M |
| ci-cd-infra | 34 | 30 | NL | 10 / 9 | 0 | M |
| collections | 33 | 35 | NL | 1 | 0 | M |
| analytical-reporting (en financial-reporting) | 30 | 25 | NL | 9 | 0 | S–M |
| intercompany | 30 | 25 | NL | 1 / 11 | 0 | L |
| supply-chain | 28 | 28 | NL | 1 | 0 | L |
| units-of-measure | 28 | 25 | NL | 1 | 0 | M |
| consolidation | 25 | 20 | NL | 2 | 1 | L (rehacer eliminaciones) |
| wms | 20 | 15 | NL | 1 | 0 | S (retirar) / L |
| price-lists | 18 | 15 | NL | 1 | 1 | L |
| projects | 18 | 10 | NL | 1 / 11 | 0 | XL (rehacer) |
| manufacturing | 15 | 10 | NL | 1 | 0 | XL (rehacer) |
| customer-service | 14 | 5 | NL | 1 | 0 | L (rehacer) |

## Matriz módulo × país

Ver `05-matriz-pais-modulo.md`. En síntesis, en **todos los grupos** al menos un módulo del núcleo tiene una compuerta crítica incumplida:

- **DO**: el más cercano; núcleo en 48.
- **US**: siguiente, para contabilidad y compras.
- **MX/CO/CL/PE/AR/EC**: no listos (e-factura sin conectar, planes de cuentas no estatutarios).
- **BR**: no listo por LOC-01.
- **UY…NI**: solo contabilidad, y así debe declararse.

## Los diez mayores riesgos del producto

1. **Proceso de entrega sin compuerta**: se fusiona con CI rojo, de modo que cualquier arreglo puede retroceder sin que nadie lo note (SP-12).
2. **Aislamiento entre tenants que depende de la memoria del desarrollador**: ya hay una escritura cruzada explotable (PLT-NOT-01) y una FK sin guarda (SP-06).
3. **Declaraciones fiscales falsas o ausentes**: el 607/608 cae en DO; en BR y en los mercados genéricos se emiten documentos con 0 % o no fiscales sin aviso (LOC-01, FAC-INV-03).
4. **Multimoneda inutilizable**: cobros 1:1 entre monedas, revaluación inexistente, documentos con tasa real rechazados por tolerancia 0 (TES-01, FINB-01, XF-09).
5. **Reglas fiscales y laborales como código sin vigencia, con DO como default implícito**: bloquea la expansión y vuelve incorrectos los cálculos retroactivos (SP-02, SP-03).
6. **Valores derivados aceptados del cliente** (impuestos, contravalores, retenciones, deducciones): riesgo de declaraciones y nóminas incorrectas (SP-04).
7. **Nómina DO con posibles errores de cotización** y carrera calcular/aprobar (NOM-01..04). Riesgo laboral y ante la TSS; verificar con un contador.
8. **Efectos externos no condicionados al entorno**: CI y los entornos de desarrollo hablan con la DGII (FAC-EINV-02, FE-CI-03).
9. **Sin respaldo y restauración probados, sin métricas ni alertas**: un incidente de datos no se detecta y no se puede revertir (FE-CI-04, PLT-OBS-01).
10. **Funciones prometidas que no existen** (manufactura, WMS, proyectos, consolidación, listas de precios, comparativos): riesgo comercial y reputacional (SP-01).

## Patrones sistémicos

Ver `07-patrones-sistemicos.md`, con 13 patrones. Los cinco que más rinden si se corrigen una vez:

- SP-01: capacidad declarada = capacidad alcanzable.
- SP-04: el servidor calcula todo importe derivado.
- SP-05: nada de `@Body()` sin DTO, y ningún error de dominio como 500.
- SP-06: toda tabla con datos de usuario lleva columna de tenant y política.
- SP-12: CI verde obligatorio y un interruptor de efectos externos.

## Madurez y preparación del producto: qué falta para llegar a 100

Núcleo mínimo para vender un ERP, con su madurez: journal-entries 66, accounting 57, chart-of-accounts 45, financial-reporting 62, invoices 55, einvoicing 40, taxes 35, customers 48, treasury 55, procurement 60, accounts-payable 58, inventory 52, auth/roles 82–83, multi-tenencia 70.

Lo acotan los ejes críticos del núcleo, la integridad multimoneda y fiscal y el proceso de entrega. Para 100 hace falta, en este orden:

1. Las fases 0 y 1 de `08-hoja-de-ruta.md`, que llevan el núcleo DO a la banda 61–70.
2. El motor de reglas por país como datos versionados, con catálogo neutro y planes estatutarios: abre MX/CO/PE/CL/AR/EC.
3. La e-factura conectada por régimen, con homologación.
4. Las capacidades básicas del mercado: pedidos de venta, lotes y series, conversiones de UdM, comparativos, retenciones locales y cobranza fuera del plan de IA.
5. La operabilidad de clase mundial: métricas, alertas, respaldo probado, importación asíncrona y fronteras de módulo limpias.

Con eso el producto llega a la banda competitiva (76–89). Por encima de 90 se necesitaría paridad funcional con NetSuite, Dynamics y Odoo en cada país, que hoy está lejos.

## Hoja de ruta

Ver `08-hoja-de-ruta.md`. El orden es: proceso, luego desbloqueo DO y declaración honesta, luego reducción de riesgo y apertura de países, luego capacidades básicas y por último diferenciación.

## Cobertura

Ver `09-cobertura-y-verificacion.md`:

- 70 fichas: 40 completas, 30 parciales, ninguna sin tocar.
- Los 10 críticos re-verificados por el coordinador; 12 altos muestreados (≈13 %, por debajo del 30 % pedido por las interrupciones de cuota), con 1 falso positivo corregido.
- Humo de UI de 155 rutas; 8 de 9 flujos cruzados en vivo; 19 mercados aprovisionados y 10 probados con un tenant propio.

## Índice

| Archivo | Contenido |
|---|---|
| `01-inventario-de-modulos.md` | Inventario cruzado de 4 fuentes y discrepancias |
| `02-estandares-de-referencia.md` | Vara por dominio y calidad de las fuentes |
| `03-resultados-de-ejecucion.md` | Paso 2: build, lint, tipos, pruebas, auditoría de dependencias, migraciones, grafo |
| `03-insumo-carga-PLT.md`, `03-insumo-humo-ui-FE.md` | Carga ligera y humo de UI |
| `04-plataforma-transversal.md` | Componentes transversales |
| `05-matriz-pais-modulo.md` (+ `-insumo-LOC.md`) | Por país |
| `06-flujos-cruzados.md` | Paso 8 |
| `07-patrones-sistemicos.md` | Patrones |
| `08-hoja-de-ruta.md` | Roadmap |
| `09-cobertura-y-verificacion.md` | Paso 9 |
| `modulos/*.md` | 70 fichas |
| `progreso.md` | Estado y reanudación |
