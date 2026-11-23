# Virtex Desktop — releases, signing and updates

Runbook for whoever ships the desktop shell. The design rationale lives in the code it describes
(`apps/desktop/src/release-verification.js`, `updater.js`, `electron-builder.config.cjs`); this page
is what to configure and what to do.

## How an update reaches a customer

```
tag desktop-v1.4.0
  └─ prepare   version = apps/desktop/package.json, channel from the version, tests + supply-chain gate
  └─ build     macOS / Windows / Linux, in the protected `desktop-release` environment
                 sign (Developer ID + notarisation · Azure Trusted Signing) → VERIFY signatures and fuses
  └─ publish   sign one release statement per manifest (Ed25519, DSSE) → SHA256SUMS, SBOM,
               SLSA provenance → upload files, then statements, then manifests → draft GitHub release
installed shell
  └─ checks the feed (HTTPS) every 4 h, after resume, and on Help → Check for updates
  └─ fetches <manifest>.release.dsse.json, verifies it, and only then downloads
  └─ electron-updater checks the SHA-512; the OS checks the code signature at install
  └─ asks the person when to restart (never mid-sale); otherwise installs on quit
```

What each control defeats:

| Threat | Stopped by |
| --- | --- |
| Tampered installer on the CDN | SHA-512 in the manifest **and** the manifest must match the signed statement |
| Compromised update bucket / CDN / DNS (attacker writes manifest + file) | The statement is signed offline with a key the server never sees |
| Replay of an old, vulnerable signed release (downgrade) | Statement must be strictly newer than the installed version; `allowDowngrade` off |
| Freezing clients on an old release with a captured statement | Statements expire (120 days); a weekly job re-signs the current ones |
| Unsigned / foreign installer on Windows | Authenticode publisher check; the shell disables updates if the build has no publisher configured |
| Binary repurposed as a Node.js runtime (`ELECTRON_RUN_AS_NODE`, `--inspect`, `NODE_OPTIONS`) | Electron fuses, verified on the shipped binary |
| Modified app code inside the bundle | asar integrity fuse + OnlyLoadAppFromAsar + platform code signature |
| Build machine compromise passing as a release | Builds only in the protected environment; SLSA provenance; `gh attestation verify` |

## One-time setup

### 1. The `desktop-release` environment

GitHub → Settings → Environments → `desktop-release`:

- **Required reviewers**: at least two people, neither the one who pushes the tag.
- **Deployment branches and tags**: only tags matching `desktop-v*` (and `main` for the scheduled refresh).
- All secrets below are **environment** secrets, never repository secrets.

### 2. Update signing key (Ed25519)

On an offline or ephemeral machine:

```bash
node tools/desktop/generate-update-keys.mjs ./virtex-desktop-2026-11.pem virtex-desktop-2026-11
```

- Private key → environment secret `DESKTOP_UPDATE_SIGNING_KEY`; plus an offline backup (two copies, two places). Then destroy the file.
- Key id → variable `DESKTOP_UPDATE_SIGNING_KEY_ID`.
- The printed JSON → variable `DESKTOP_UPDATE_TRUSTED_KEYS` (public; it is built into every installer).

### 3. macOS

- Apple Developer Program, **Developer ID Application** certificate exported as `.p12`:
  - `MAC_CSC_LINK` (base64 of the `.p12`)
  - `MAC_CSC_KEY_PASSWORD`
- App Store Connect API key with the Developer role, used for notarisation:
  - `APPLE_API_KEY_P8` (the `.p8` contents)
  - `APPLE_API_KEY_ID`
  - `APPLE_API_ISSUER`

### 4. Windows — Azure Trusted Signing

- Create a Trusted Signing account with a Public Trust certificate profile, completing the identity validation.
- Create a service principal with the *Trusted Signing Certificate Profile Signer* role on that profile. Store it as:
  - `AZURE_TENANT_ID`
  - `AZURE_CLIENT_ID`
  - `AZURE_CLIENT_SECRET`

  Rotate the secret at least every 90 days.
- Variables:
  - `AZURE_TRUSTED_SIGNING_ENDPOINT` (e.g. `https://eus.codesigning.azure.net`)
  - `AZURE_TRUSTED_SIGNING_ACCOUNT`
  - `AZURE_TRUSTED_SIGNING_PROFILE`
  - `WINDOWS_PUBLISHER_NAME`: exactly the certificate subject CN. The updater compares it.

### 5. Update feed

An S3 bucket served through CloudFront over HTTPS (TLS 1.2+), with no public write.

The publish job assumes the role `AWS_DESKTOP_RELEASE_ROLE_ARN` through GitHub OIDC. Trust only this repository and the `desktop-release` environment; grant `s3:PutObject` and `s3:GetObject` on the prefix, and `cloudfront:CreateInvalidation`.

Variables:

- `AWS_REGION`
- `DESKTOP_UPDATE_BUCKET`
- `DESKTOP_UPDATE_BUCKET_PREFIX` (optional)
- `DESKTOP_UPDATE_CLOUDFRONT_ID` (optional)
- `DESKTOP_UPDATE_FEED_URL`: the public HTTPS URL of that prefix

Enable bucket versioning and object lock in governance mode on the prefix. A mistaken or hostile overwrite can then be reverted.

### 6. What the shell points at

| Variable | Meaning |
| --- | --- |
| `DESKTOP_PORTAL_URL`, `DESKTOP_POS_URL` | HTTPS origins the window may show |
| `DESKTOP_TLS_PINS` | Optional. Comma-separated base64 SPKI SHA-256 pins, at least two: the live key **and a backup key not yet deployed**. Pin the intermediate CA if certificates are renewed often. A wrong pin locks every client out until a new build ships, so test it on a beta channel first. |
| `DESKTOP_CRASH_SUBMIT_URL` | Optional HTTPS crash collector. Without it, dumps stay on the machine (Help → Open the logs folder). |

## Shipping a release

1. Bump `apps/desktop/package.json` `version`: `1.4.0` for stable, or `1.5.0-beta.1` for the beta channel.
2. Merge, then tag: `git tag desktop-v1.4.0 && git push origin desktop-v1.4.0`.
3. Approve the `desktop-release` environment when the build asks. Two reviewers.
4. The draft GitHub release appears with the installers, `SHA256SUMS`, the SBOM and the attestation. Publish the draft once smoke-tested.

Dry run without publishing: *Actions → Desktop release → Run workflow* (`dry_run` is on by default).

### Mandatory update (security or fiscal fix)

Run the workflow with `minimum_supported_version` set to the first fixed version. Every build below
it shows a prompt that cannot be dismissed for good, every 10 minutes, until the person restarts.
The weekly refresh preserves the floor.

### Staged rollout

electron-updater honours `stagingPercentage` in the channel manifest. To roll out to 10 % first:

1. Edit `latest*.yml` in the bucket to add `stagingPercentage: 10`.
2. Re-run the refresh job (*Run workflow* on a schedule-capable ref).

The statement does not cover that field, so changing it needs no re-signing.

### Withdrawing a release

Restore the previous `latest*.yml` and `*.release.dsse.json` from the bucket's version history. Clients that already updated stay on the withdrawn version: downgrades are refused by design. Ship a fixed higher version instead.

## Key rotation (planned, yearly)

1. Generate the new key (`virtex-desktop-2027-11`) and **add** it to `DESKTOP_UPDATE_TRUSTED_KEYS` next to the old one.
2. Ship one release still signed with the old key. Clients now trust both.
3. Switch `DESKTOP_UPDATE_SIGNING_KEY` / `_KEY_ID` to the new key.
4. After the old-key builds age out (check the version distribution), remove the old key from `DESKTOP_UPDATE_TRUSTED_KEYS` in a later release.

## Key compromise (incident)

1. Revoke at once: delete the secret and rotate the AWS role's trust. Freeze the bucket with an object-lock legal hold.
2. Generate a new key and ship a release, signed by the **old** key, that trusts **only** the new key.
   - This is the last thing the old key ever signs.
   - Set `minimum_supported_version` to that release.
3. Any statement the attacker signs with the old key is then refused by every updated client.
4. Clients that never updated remain exposed until they do. Communicate directly with those customers.

## Managed fleets (Intune, SCCM, Jamf)

Set `VIRTEX_DESKTOP_UPDATES=disabled` machine-wide and deploy the signed installers from the GitHub release. Before deploying, verify each one with `gh attestation verify <file> --repo JSL-Technology/virtex`.

The shell logs that updates are managed and says so in Help → Check for updates.

## Accepted risks and limits

- **Linux**: packages carry no OS code signature (there is no universal one). Integrity rests on the signed release statement and the SLSA attestation. `.deb`/`.rpm` installs do not auto-update; distribute them through a signed APT/YUM repository if a customer needs that, and use AppImage for auto-update.
- **Build-tool advisory** `GHSA-g3hv-75wg-m249` (minimatch ReDoS) is accepted until 2027-02-01. It is build-time only; see `apps/desktop/security-baseline.json`.
- **Not yet exercised in this repository**: a real signed build on macOS and Windows runners, notarisation, and an end-to-end update from a live feed. The first tagged release is the acceptance test. Run it as a dry run, then on the beta channel.
