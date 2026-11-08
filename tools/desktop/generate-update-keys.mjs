#!/usr/bin/env node
/**
 * Generate an Ed25519 key pair for signing desktop release statements.
 *
 *     node tools/desktop/generate-update-keys.mjs <private-key-output-path> [key-id]
 *
 * The private key is written with mode 0600 and must go straight into the release environment's
 * secret store (DESKTOP_UPDATE_SIGNING_KEY) and an offline backup — never into the repository, a
 * chat, or the update server. The public key and key id printed here go into
 * DESKTOP_UPDATE_TRUSTED_KEYS. Rotation is documented in docs/desktop-release.md.
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const [outPath, keyIdArg] = process.argv.slice(2);
if (!outPath) {
  console.error('usage: generate-update-keys.mjs <private-key-output-path> [key-id]');
  process.exit(2);
}
if (existsSync(outPath)) {
  console.error(`✗ ${outPath} exists; refusing to overwrite a signing key.`);
  process.exit(1);
}
const keyId = keyIdArg || `virtex-desktop-${new Date().toISOString().slice(0, 7)}`;
if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
  console.error('✗ key id must match [A-Za-z0-9._-]{1,64}');
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(outPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
console.log(`key id: ${keyId}`);
console.log(`private key: ${outPath} (0600) → secret DESKTOP_UPDATE_SIGNING_KEY, plus offline backup`);
console.log('DESKTOP_UPDATE_TRUSTED_KEYS entry:');
console.log(JSON.stringify({ [keyId]: publicKey.export({ type: 'spki', format: 'pem' }) }));
