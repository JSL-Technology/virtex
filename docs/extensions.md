# Extensions — the virtual machine for extensions

A marketplace of signed, admitted extensions that run in a hardened V8 isolate, gated by
per-tenant consent and metered for usage billing. Consolidated from special-enigma's standalone
`plugin-host` microservice into the API as a normal NestJS module (`apps/backend/api/src/app/extensions`).

## Security model

An extension must clear the **admission pipeline** before it is admitted to the catalogue, and its
signature is verified again before **every** execution:

1. **Admission** (`PluginAdmissionService`): SBOM presence (CycloneDX ≥ 1.4) → OPA policy →
   SAST (SonarQube quality gate) → SCA (forbidden dependencies) → heuristic source scan
   (`eval`, `new Function`, `child_process`, `fs`, prototype pollution) → DAST → **sign**.
   Pure checks always run; the external scanners (OPA/Sonar/DAST) are best-effort in non-production
   and **mandatory in production**.
2. **Execution** (`SandboxService`): the code runs in an `isolated-vm` isolate with a hard memory
   limit and an execution timeout. The isolate has no ambient `require`/globals — only a narrow
   syscall bridge: `log`, and a `fetch` that is **capability-gated** (`egress:http`), restricted to
   the egress allowlist, and SSRF-protected (private/loopback resolutions are refused). WASM modules
   are supported under the same envelope.
3. **Consent**: a version's declared capabilities require an explicit per-tenant consent row before
   execution is allowed. The tenant is taken from the authenticated principal, never a header.
4. **Metering**: every execution appends a usage record (wall time, peak heap, egress count);
   `BillingService` rolls these up into a per-tenant reconciliation report.

The `isolated-vm` native addon is loaded lazily, so the API still boots on a host that cannot
compile it — execution then fails with a clear error instead of the process refusing to start.

## API (`/extensions`, behind auth + permissions)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/extensions` | `extensions:view` | List catalogue |
| GET | `/extensions/consents` | `extensions:view` | This tenant's consents |
| GET | `/extensions/:name` | `extensions:view` | One extension + versions |
| POST | `/extensions` | `extensions:manage` | Admit + register a version |
| POST | `/extensions/:name/revoke` | `extensions:manage` | Revoke |
| PUT | `/extensions/:name/consent` | `extensions:install` | Grant capabilities / enable |
| POST | `/extensions/execute` | `extensions:execute` | Run in the sandbox |
| GET | `/extensions/billing/reconciliation` | `extensions:manage` | Usage report |

Frontend manager: **Administration → Extensions** (`features/extensions`).

## Configuration

See the `Extensions` section of `.env.example`. Key variables: `MARKETPLACE_SIGNING_KEYS`
(mandatory in production), `ALLOW_EPHEMERAL_PLUGIN_KEYS` (dev only), `PLUGIN_EGRESS_ALLOWLIST`,
`PLUGIN_MEMORY_LIMIT_MB`, `PLUGIN_TIMEOUT_MS`, `PLUGIN_DAST_MODE`. OPA policy:
`platform/policies/security/plugin_admission.rego`.
