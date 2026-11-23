# Ficha — shared-backend (app/shared, app/common, app/contracts, app/core)
Familia PLTA · 2026-11-07 · Diagnóstico. Fuente de fronteras: `scratchpad/logs/boundaries-report.log` (1.237 violaciones globales).

## 1. Identificación
- `shared/` (53 archivos, 3.802 l.; 18 specs): tenancy (`tenant-connection.interceptor`, `active-tenant.guard`, `tenant-isolation.check`, clasificación de tablas), idempotency, after-commit, scheduler/scheduling, jobs, rate-limit, http (cors), observability, permissions (agregador), **document-sequences (controlador+servicio+entidad)**, **numbering**, **statements (estado de cuenta de socio)**, **fiscal-clock**, inbox, transitions, lifecycle.
- `common/` (29 archivos, 2.407 l.; 8 specs): pipes, validadores (incl. **`fiscal-profile.validator.ts` 278 l.**), `money.ts`, `dates.ts`, `parse-decimal.ts`, interceptores de archivos, `encrypted-column.transformer`, `common.module.ts` (importa UsersModule, OrganizationsModule, LocalizationModule).
- `contracts/` (30 archivos, 2.382 l.; 4 specs): puertos entre dominios (accounting, approvals, audit, closing, ledger-posting, treasury, inbound-mail, data-transfer…).
- `core/models/general-ledger.model.ts` (45 l., usado solo por `accounting/ledgers.service.ts`).

## 2. Estándar de referencia
Kernel compartido mínimo y sin dominio (tipos de valor como Money, utilidades técnicas, infraestructura de tenancy); el dominio vive en su módulo y se expone por contratos; ninguna dependencia de shared hacia dominios (regla de dependencia). Referencia: DDD "shared kernel" y monolito modular (Kamil Grzybek, "Modular Monolith") — confianza media.

## 3. Resultado
**Madurez 55 (48–62, confianza media)**; preparación N/A (no vendible por sí mismo; nota de soporte 55); **Piloto controlado**. Eje más débil: 5 (higiene/dirección de dependencias). Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 70 | Infraestructura real y usada (idempotencia exigida en decisiones: `common.idempotency_key_required`; tenancy por request) | — |
| 2 | 68 | `money.ts`/`parse-decimal.ts` centralizan decimales; idempotencia con registro por tenant | — |
| 3 | 50 | `fiscal-clock.ts` y `common/validators/fiscal-profile.validator.ts` importan `localization/fiscal/country-profiles`, `tax-id-validators`, `identity-document-catalogue` (boundaries l.284-287, 730-733) → reglas fiscales por país dentro de "common" | Mover a localization y exponer por contrato |
| 4 | 58 | `contracts/` bien encaminado (puertos + registros); pero `shared/` contiene servicios con controlador propio (`document-sequences` con `PATCH /document-sequences/:type`) y SQL de estado de cuenta de clientes/proveedores (`shared/statements/partner-statement.ts`) | Dueño de dominio para secuencias y estados de cuenta |
| 5 | **40 (33–48, media)** | Plataforma → identidad (12–14 imports privados), → configuración (4–5), → ventas (3–5), → inventario, contabilidad, finanzas, rrhh, reportes (boundaries-report). `shared/permissions.ts:16-22` importa permisos de auth, invoices, inventory, accounting, treasury, payroll, reports; `common/common.module.ts:5-7` importa UsersModule, OrganizationsModule, LocalizationModule; `shared.module.ts:14,23` registra la entidad `Organization` (foreign-entity-registration). Ciclos plataforma↔reportes y configuración↔plataforma listados por el coordinador | Invertir dependencias: shared no importa dominios; permisos registrados por cada módulo |
| 6 | 62 | lint: warnings globales; archivos ≤280 l. | — |
| 7 | 65 | `tenant-connection.interceptor` fija una conexión por request y hace rollback de transacciones abiertas | — |
| 8 | 70 | `tenant-isolation.check` y clasificación de tablas (227 l.) | RLS no aplica en este entorno (superusuario) |
| 9 | 65 | 30 specs en shared/common/contracts; todas pasan (55 suites/534 tests en ejecución PLTA) | — |
| 10 | 60 | — | — |
| 11 | N/A | | |
| 12 | N/A | | |

## 5. Compuertas
1 Cumple · 2 Cumple · 3 Cumple (infra de tenancy) · 4 Cumple · 5 Cumple · 6 Parcial (reglas país en common) · 7 Cumple · 8 N/A · 9 N/A · 10 N/A · 11 N/A · 12 Parcial.

## 6. Hallazgos
- **PLT-SH-01** · shared/common · eje 5 · mezcla de contexto · **Alta** · `common/common.module.ts:5-7`, `shared/permissions.ts:16-22`, `shared/shared.module.ts:14,23`, `common/validators/fiscal-profile.validator.ts:12-18`, `shared/fiscal-clock.ts:18` · El "núcleo compartido" depende de identidad, organizaciones, localización y 6 dominios: cualquier módulo que importe `CommonModule` arrastra Users/Organizations/Localization, y es la raíz de varios de los 14 ciclos de módulo. Retocar import por import no basta: hay que invertir la dirección (registro de permisos y perfiles fiscales por contrato). · Impide extraer/evolucionar módulos. · L.
- **PLT-SH-02** · shared · eje 4 · arquitectura · Media · `shared/document-sequences/*` (controlador, servicio, entidad), `shared/statements/partner-statement.ts`, `shared/numbering/document-numbers.ts` · Lógica de dominio (numeración de documentos fiscales, estado de cuenta de socios) sin dueño en "shared". · Asignar a facturación/contabilidad o a un módulo "documentos" con contrato. · M.
- **PLT-SH-03** · core · eje 5 · higiene · Baja · `core/models/general-ledger.model.ts` usado solo por `accounting/ledgers.service.ts` · carpeta con un solo modelo de contabilidad. · Mover a accounting. · S.

## 7. Camino mínimo
No bloquea un piloto; para producción a escala: invertir dependencias de `CommonModule` y `permissions.ts` (L), reubicar document-sequences/statements (M).
## 8. Camino a 100
Shared sin imports de dominio verificado por `module-boundaries` sin baseline para plataforma (+20, L); kernel de valor (Money, fechas) separado de infraestructura (+5, S).
## 10. Fortalezas
`contracts/` con puertos y registros (approvals, inbound-mail, data-transfer, ledger-posting); idempotencia y after-commit reutilizables; verificadores de fronteras ya existen.
## 11. No verificado
Cada uno de los 18 subdirectorios de shared en profundidad.
