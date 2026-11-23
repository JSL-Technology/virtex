# Virtex Desktop (Electron)

A hardened Electron shell around the web portal and the standalone POS terminal, with signed
installers and verified automatic updates. Releases: [docs/desktop-release.md](../../docs/desktop-release.md).

## Run (development)

```bash
nx serve client-web      # portal on :4200
nx serve pos             # POS terminal on :4300 (optional)
npm ci --prefix apps/desktop --ignore-scripts   # the shell's own runtime dependency (once)
nx serve desktop
```

- **Go → Portal** (⌘/Ctrl+1) and **Go → Point of sale** (⌘/Ctrl+2).
- **Help → Check for updates / Open the logs folder / About**.
- In development the origins come from `DESKTOP_PORTAL_URL` / `DESKTOP_POS_URL` (default the local
  servers) and updates are off. A **packaged** build ignores the environment and reads only the
  configuration built into it (`config/app-config.json`, written by `tools/desktop/write-app-config.mjs`).

## Layout

| Path | What it is |
| --- | --- |
| `package.json`, `package-lock.json` | The **application's** manifest: what goes into the installer. One runtime dependency (`electron-updater`), pinned. Electron and electron-builder are root dev dependencies and never ship. |
| `src/main.js` | Main process: window, navigation guard, session hardening, menu, updater wiring. |
| `src/preload.js` | The only bridge to the page (`window.virtexDesktop`), through `contextBridge`. |
| `src/security-policy.js` | Trust decisions as pure functions: origins, external links, permissions, baseline CSP, TLS pins. |
| `src/app-config.js` | Loads and validates the configuration (built-in when packaged, environment in development). |
| `src/release-verification.js` | Verifies signed release statements (DSSE, Ed25519) before an update is downloaded. |
| `src/updater.js` | Check → verify → download → ask → install. |
| `src/logger.js` | JSON-lines log with rotation, in the OS logs folder. |
| `electron-builder.config.cjs` | Packaging: fuses, asar, signing, notarisation, targets. Refuses to build a release without every signing input. |
| `build/` | Build resources: macOS entitlements, the per-platform list of release inputs. |
| `security-baseline.json` | Minimum Electron, supported majors, and time-boxed accepted advisories. |

## Security posture

| Layer | Control |
| --- | --- |
| Renderer | `app.enableSandbox()` for every renderer, context isolation, no Node, no `<webview>`, DevTools off when packaged, narrow preload; IPC accepted only from trusted frames. |
| Navigation | Only the two configured origins (exact origin match); redirects guarded; links leave only for `https:` / `mailto:` without credentials. |
| Network | OS certificate verification always applies; errors are refused and logged; optional SPKI pinning (≥2 pins) for the configured hosts; an additive baseline CSP (`object-src 'none'; base-uri 'self'; frame-ancestors 'none'`). |
| Permissions | Denied except clipboard-write, fullscreen and notifications, and only to trusted origins. |
| Binary | Electron fuses: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, asar integrity validation, app code only from the asar, cookie encryption, no `file://` privileges. Verified on the shipped binary in the release workflow. |
| Signing | macOS: Developer ID, hardened runtime, minimal entitlements (`allow-jit` only), notarised and stapled. Windows: Authenticode via Azure Trusted Signing (HSM), SHA-256 with RFC 3161 timestamp. |
| Updates | HTTPS feed; every update must match a release statement signed offline with Ed25519 (DSSE) for this product, channel, platform, architecture and version; no downgrades, no expired statements; platform signature checked again at install; fails closed on Windows without a configured publisher. |
| Supply chain | Electron pinned exactly; `verify:desktop-supply-chain` (CI) enforces the baseline and supported majors and allows no advisory in what the installer ships; SBOM and SLSA provenance per release. |

## Tests

```bash
nx test desktop                    # 54 tests: policy, verification, config, updater, logger, build invariants, release tooling
npm run verify:desktop-supply-chain
```

## Local packages (unsigned, for testing only)

```bash
nx run desktop:package             # unsigned; no publish configuration, so it can never become an update
```

Signed releases are produced only by `.github/workflows/desktop-release.yml`.
