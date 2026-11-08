import * as forge from 'node-forge';
import { readFileSync } from 'fs';

/**
 * Whether a signing certificate was issued by an authority the tax administration accepts
 * (audit 2026-10-31, EINV-03).
 *
 * Only self-signed certificates were refused: a leaf issued by any home-made CA — "QA-F5 Fake CA"
 * with the company's RNC in it — was accepted, unlocked issuance, and the authority's rejection came
 * days later. The chain in the PKCS#12 (leaf plus whatever intermediates it carries) must now lead,
 * with valid signatures and dates, to one of the trust anchors configured for the market.
 *
 * The anchors are data, not code: the certification providers the DGII authorises change, and each
 * market has its own. `ECF_TRUSTED_CA_BUNDLE_<CC>` names a PEM file with the roots (and, if they are
 * not shipped inside the customers' files, the intermediates) for country CC.
 */
export type TrustVerdict =
  | { trusted: true; anchor: string | null }
  | { trusted: false; reason: 'no_trust_store' | 'untrusted_chain' };

/** Every certificate in a PEM bundle. */
export function parsePemBundle(pem: string): forge.pki.Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  return blocks.map((block) => forge.pki.certificateFromPem(block));
}

/** Reads the anchors configured for a market; empty when none is configured. */
export function loadTrustAnchors(
  country: string,
  read: (key: string) => string | undefined,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): forge.pki.Certificate[] {
  const path = read(`ECF_TRUSTED_CA_BUNDLE_${country.toUpperCase()}`)?.trim();
  if (!path) return [];
  return parsePemBundle(readFile(path));
}

/**
 * Verify `leaf` (with the `intermediates` its file carries) against `anchors`, at `now`. The leaf
 * must chain to an anchor through signatures that verify and certificates in force; an anchor-less
 * market answers `no_trust_store`, which the caller decides how to treat.
 */
export function verifyCertificateChain(
  leaf: forge.pki.Certificate,
  intermediates: readonly forge.pki.Certificate[],
  anchors: readonly forge.pki.Certificate[],
  now: Date = new Date(),
): TrustVerdict {
  if (anchors.length === 0) return { trusted: false, reason: 'no_trust_store' };
  const store = forge.pki.createCaStore([...anchors]);
  // The path from the leaf up, ordered: each certificate followed by its issuer, as forge expects.
  const path: forge.pki.Certificate[] = [leaf];
  const pool = [...intermediates];
  for (;;) {
    const current = path[path.length - 1];
    if (store.hasCertificate(current) || anchors.some((a) => safeIssued(a, current))) break;
    const next = pool.findIndex((candidate) => safeIssued(candidate, current));
    if (next < 0) break;
    path.push(pool.splice(next, 1)[0]);
  }
  try {
    forge.pki.verifyCertificateChain(store, path, { validityCheckDate: now });
  } catch {
    return { trusted: false, reason: 'untrusted_chain' };
  }
  const anchor = anchors.find((a) => safeIssued(a, path[path.length - 1]) || store.hasCertificate(path[path.length - 1]));
  return { trusted: true, anchor: anchor?.subject.getField('CN')?.value ?? null };
}

/**
 * Whether `issuer` issued `subject`: its subject names `subject`'s issuer AND its key verifies
 * `subject`'s signature.
 *
 * `issuer.issued(subject)`, not `issuer.isIssuer(subject)`: in node-forge `a.isIssuer(b)` asks the
 * opposite question ("was `a` issued by `b`?"). Up to node-forge 1.4.0 `isIssuer` compared only the
 * NUMBER of name attributes, so the reversed call passed for any two single-CN names and the
 * signature check alone held the line; 1.4.3 compares the names properly and exposed the reversal.
 */
function safeIssued(issuer: forge.pki.Certificate, subject: forge.pki.Certificate): boolean {
  try {
    return issuer.issued(subject) && issuer.verify(subject);
  } catch {
    return false;
  }
}
