# Merge from `special-enigma`

This records what was taken from `github.com/JuanPoueriet/special-enigma` into this repository,
and — just as importantly — what was deliberately not.

## The two repositories

- **virtex (this repo)** is the working product: a consolidated NestJS API (~55 ERP modules on
  TypeORM) and an Angular client, actively hardened (auth, RLS multi-tenancy, e-CF fiscal, tabs).
- **special-enigma** is an over-scaffolded fork of the same product: 28 microservices, 9 edge/BFF
  apps and 29 domain libraries under a DDD layout — but ~70% of it is scaffolding (index re-exports,
  generated test/config boilerplate; 607 of 1581 library files are under 15 lines), with real code
  concentrated in a few pockets.

## Strategy

Keep virtex as the base **and** its consolidated architecture. Harvest special-enigma's genuinely
valuable *logic and features* and integrate them as ordinary virtex modules — **no new
microservices, no domain-library explosion**. Persistence was adapted from special-enigma's MikroORM
to virtex's TypeORM. The app stays buildable after every change.

## What was consolidated

| Feature | From | Into |
| --- | --- | --- |
| **Virtual machine for extensions** (isolated-vm sandbox, admission pipeline, per-tenant consent, metering/billing) | `apps/service/plugin-host` | `apps/backend/api/src/app/extensions` + `features/extensions` — see [extensions.md](./extensions.md) |
| **Point of sale** (shifts + atomic till sales) | `libs/domain/pos` | `apps/backend/api/src/app/pos` + wired `features/sales/pos` — see [pos.md](./pos.md) |
| **OPA plugin-admission policy** | `platform/policies/security` | `platform/policies/security/plugin_admission.rego` |

Both features ship with migrations, permissions (auto-catalogued + i18n in es/en/pt), and tests.

## What was intentionally not adopted, and why

- **The microservices / DDD domain explosion.** It contradicts the project's constraint and would
  break the working product for no functional gain — most of it is empty scaffolding.
- **Redundant domains.** virtex already has richer, live implementations of accounting, inventory,
  manufacturing, purchasing, sales, HCM, BI, notifications, SaaS and payments than special-enigma's
  mostly-stub equivalents, so porting them would be a regression, not a merge.
- **Aspirational infra/architecture docs** describing 28 services virtex does not run — they would
  misdescribe this system.

Auth hardening, tenancy and fiscal were reviewed and found already equal-or-stronger in virtex
(RLS, e-CF, admission-grade auth), so no changes were pulled there.
