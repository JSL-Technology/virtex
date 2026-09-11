# Independent module analysis — virtex vs special-enigma

A module-by-module review to decide, for each, whether special-enigma had anything worth merging.
The method for each: (1) what virtex already has, (2) whether special-enigma's counterpart is real
code or scaffolding, (3) the verdict.

**Realness of enigma counterparts** is measured as non-stub, non-test, non-config lines in the
matching `libs/domain/*` (or `apps/service/*`). Recall the baseline: enigma is ~70% scaffolding —
607 of 1581 library files are under 15 lines — so a large folder is not, by itself, real code.

## Summary

| Verdict | Count | Meaning |
| --- | --- | --- |
| **Merged** | 2 | Net-new capability brought in (extensions, POS). |
| **virtex richer — no merge** | ~20 | virtex's live module is denser/more correct than enigma's stub/skeleton. |
| **Equivalent/handled — no merge** | ~15 | Concern already covered by a consolidated virtex module. |
| **virtex-only** | ~23 | No enigma counterpart at all. |

Nothing was removed from virtex. The two merges are additive and consolidated (no new microservice,
no new domain library).

## Merged (net-new)

| virtex module | From enigma | Notes |
| --- | --- | --- |
| `extensions` | `apps/service/plugin-host` (1132 real lines) | isolated-vm sandbox, admission pipeline, consent, metering/billing. The flagship. → [extensions.md](./extensions.md) |
| `pos` (+ standalone `apps/pos` app) | `libs/domain/pos` (567) | shift lifecycle + atomic till sale (decrements stock in the sale's transaction). → [pos.md](./pos.md) |

## Auth & identity

special-enigma splits identity across many services (`identity` 9712, `session` 141, `token` 92,
`authn-credential` 225, `authorization-policy` 54, `risk-adaptive-auth` 61, `identity-audit-ledger`
66, `identity-profile` 147, `api-access-gateway` 101, `provisioning-federation` 61). virtex has a
single, already-hardened `auth` module plus `roles`, `users`, `organizations`, and DB-enforced
tenancy.

| Concern | virtex | Verdict |
| --- | --- | --- |
| `auth` | Argon2, JWT rotation, CSRF double-submit (`__Host-` cookie), step-up, session revocation, 7-controller split | **Equivalent/handled** — virtex's is production-grade; enigma's `identity` is a gRPC skeleton. No merge. |
| `roles` / permissions | ABAC + `PermissionsGuard` as APP-guard, catalogue derived from constants | **virtex richer.** enigma `authorization-policy` is 54 lines. |
| multi-tenancy | Postgres **RLS** (`1789002100000-TenantRowLevelSecurity`) + `organizationId` scoping | **virtex richer** than enigma's `kernel/tenant`. |
| risk-adaptive / step-up | virtex `auth` has step-up decorators | **Equivalent** — enigma `risk-adaptive-auth` (61 lines) adds nothing runnable. |

The OPA `plugin_admission.rego` policy was the one identity-adjacent artefact worth taking, and it
came in with `extensions`.

## Finance & accounting

| virtex module | enigma counterpart (real LOC) | Verdict |
| --- | --- | --- |
| `accounting`, `journal-entries`, `chart-of-accounts`, `consolidation`, `intercompany`, `cost-accounting`, `budgets`, `dimensions`, `financial-reporting`, `analytical-reporting`, `reconciliation` | `accounting` (6185) | **virtex richer.** virtex's ledger is a live double-entry system with period close, inflation adjustment, RLS; enigma's is largely contract/benchmark test scaffolding. No merge. |
| `einvoicing`, `taxes`, `compliance` | `fiscal` (2834) | **virtex richer.** virtex ships DR e-CF (DGII) end-to-end, tax determination, per-regime certificates. enigma's DIAN/US-tax adapters target markets virtex models differently; porting would regress the working e-CF path. No merge (revisit per-market later). |
| `payment`, `treasury` | `billing` (2810), `treasury` (993) | **virtex richer** for payments/treasury. Usage-billing ideas from enigma were realised instead inside `extensions` metering. |
| `accounts-payable`, `suppliers`, `procurement` | `purchasing` (1080) | **virtex richer.** |
| `fixed-assets` | `fixed-assets` (547) | **virtex richer** (live module vs skeleton). |

## Operations & commercial

| virtex module | enigma counterpart | Verdict |
| --- | --- | --- |
| `inventory`, `supply-chain`, `units-of-measure`, `price-lists` | `inventory` (1941), `catalog` (1104) | **virtex richer** (row-locked stock, warehouses). |
| `sales`, `invoices`, `customers`, `customer-service` | `crm` (1217) | **virtex richer.** |
| `manufacturing` | `manufacturing` (710) | **virtex richer.** |
| `projects` | `projects` (339) | **virtex richer.** |
| `hcm` | `payroll` (2018) | **virtex richer** as a live module; enigma payroll is calculation scaffolding. No merge. |
| `saas` | `subscription` (1502) | **Equivalent/handled** — virtex `saas` enforces subscription state as an APP-guard; extension usage-billing added in `extensions`. |
| `bi`, `dashboard`, `reports`, `datasheets` | `bi` (935) | **virtex richer.** |
| `notifications`, `push-notifications`, `mail` | `notification` (742) | **virtex richer.** |

## Platform / cross-cutting

| virtex module | enigma counterpart | Verdict |
| --- | --- | --- |
| `queues`, `cache`, `storage`, `search`, `metrics`, `health`, `websockets`, `i18n`, `localization`, `geo`, `audit`, `workflows`, `my-work`, `common`, `shared` | `kernel/*`, `platform/*` | **Equivalent/handled.** virtex already has BullMQ queues, Redis cache, S3 storage, Prometheus metrics, pino logging, server i18n, an audit subscriber, idempotency + RLS. enigma's kernel/platform libs are thinner or scaffolding. No merge. |

## virtex-only (no enigma counterpart)

`batch-processes`, `config`, `core`, `database`, plus the fiscal/DR-specific depth of `einvoicing`,
`localization`, and `my-work`. These have nothing to take from enigma.

## Conclusion

The only genuinely net-new, real capabilities special-enigma held over virtex were the **extensions
virtual machine** and the **POS domain** — both now merged. Everywhere else, virtex's consolidated,
live modules are equal to or richer than enigma's mostly-scaffolded domains, so merging them would
have been a regression. This is consistent with the constraint to avoid microservices/domains: there
was no functional reason to adopt enigma's architecture, and good reason not to.
