/**
 * One-time: map every old catalogue key to its name under the new convention.
 *
 * ## How a new name is chosen
 *
 * A segment is rebuilt only if it actually needs it. "Needs it" is decided from data rather than
 * from a word list: every word appearing in any ENGLISH catalogue value forms the reference
 * vocabulary, and a segment holding a word that never appears there is not English. That catches
 * `EXITOSAMENTE` and `CUADRA` without anyone having had to predict them, and leaves `ACCOUNT_FORM`
 * and `DESCRIPTION_LABEL` alone — which matters, because an English leaf already carries a
 * distinction (`DESCRIPTION_COLUMN` vs `DESCRIPTION_LABEL`) that rebuilding from the value would
 * collapse.
 *
 * A segment that does need rebuilding is taken from the key's own ENGLISH value, which is already
 * idiomatic, capped at six words so the result reads as a name and not as the sentence. When there
 * is no English value to read — a parent segment, or an empty string — {@link ES_EN_TERMS} maps it
 * word by word instead.
 *
 * Writes `rename-map.json` next to this file; `migrate-key-names.mjs` applies it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseSegment, segmentFromText, splitPlural, isValidKey, words } from '../lib/keys.mjs';
import { ES_EN_TERMS } from './es-en-key-terms.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

const SIDES = [
  `${ROOT}/apps/core/client-web/src/assets/i18n`,
  `${ROOT}/apps/backend/api/src/app/i18n/messages`,
];

const LANGUAGES = ['es', 'en', 'pt'];

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' && !Array.isArray(v) ? flat(v, p ? `${p}.${k}` : k) : [[p ? `${p}.${k}` : k, v]]);

const values = (o) => Object.values(o).flatMap((v) =>
  v && typeof v === 'object' ? values(v) : typeof v === 'string' ? [v] : []);

/**
 * Words that are legitimately not English prose: abbreviations, product names, fiscal codes and
 * technical tokens. They pass the vocabulary check without being in it.
 */
const ALLOWED_NON_WORDS = new Set(`sidebar masters einvoicing saas dash coa cxc cxp fcf uom p12 pfx idp jwt sod saft
ncf rnc dgii encf cfdi sat afip cuit dian sii sunat sri rut ruc rfc nit nif ubigeo ncm cfop caf nfe ecf pos wms mrp
psa hcm ap ar gl kpi ocr sso mfa otp qr pdf csv xml json api url uri env cli ui ux crud rbac rls tss infotep afp ars
sfs srl webauthn oauth2 oauth recaptcha captcha stripe virteex e164 iso8601 f001 aria preheader roadmap rail
minlength maxlength colspan href src svg png webp html css scss ts js mjs hbs`.split(/\s+/).filter(Boolean));

const isCode = (w) => /^[a-z]?\d+[a-z]?$/.test(w) || /^\d+$/.test(w) || w.length <= 2;

const CURATED = JSON.parse(fs.readFileSync(`${HERE}/rename-overrides.json`, 'utf8'));

// ---------------------------------------------------------------------------
// Reference vocabulary: every word used in an English value, anywhere.
// ---------------------------------------------------------------------------
const ENGLISH_VOCAB = new Set();
for (const dir of SIDES) {
  for (const v of values(JSON.parse(fs.readFileSync(`${dir}/en.json`, 'utf8')))) {
    for (const w of v.toLowerCase().match(/[a-z]{2,}/g) ?? []) ENGLISH_VOCAB.add(w);
  }
}

const isEnglishWord = (w) => ENGLISH_VOCAB.has(w) || ALLOWED_NON_WORDS.has(w) || isCode(w);
const isEnglishSegment = (seg) => words(seg).every((w) => isEnglishWord(w.toLowerCase()));

function segmentFromTerms(segment) {
  return words(segment)
    .map((w) => w.toLowerCase())
    .map((w) => ES_EN_TERMS[w] ?? w)
    .join('_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'value';
}

const map = {};
const stats = { kept: 0, fromEnglishValue: 0, fromTerms: 0, curated: 0, collisions: 0, merged: 0 };

for (const dir of SIDES) {
  const es = Object.fromEntries(flat(JSON.parse(fs.readFileSync(`${dir}/es.json`, 'utf8'))));
  const en = Object.fromEntries(flat(JSON.parse(fs.readFileSync(`${dir}/en.json`, 'utf8'))));
  const byLanguage = Object.fromEntries(LANGUAGES.map((l) =>
    [l, Object.fromEntries(flat(JSON.parse(fs.readFileSync(`${dir}/${l}.json`, 'utf8'))))]));
  /** Every translation of a key, so two keys saying the same thing can be recognised. */
  const content = (key) => LANGUAGES.map((l) => byLanguage[l][key] ?? '').join('\u0000');
  const taken = new Map();

  for (const oldKey of Object.keys(es)) {
    if (CURATED[oldKey]) {
      map[oldKey] = CURATED[oldKey];
      taken.set(CURATED[oldKey], oldKey);
      stats.curated++;
      continue;
    }

    const segments = oldKey.split('.');
    const rebuilt = segments.map((seg, i) => {
      const isLeaf = i === segments.length - 1;
      const [stem, plural] = isLeaf ? splitPlural(seg) : [seg, null];

      let base;
      if (isEnglishSegment(stem)) {
        base = normaliseSegment(stem);
        stats.kept++;
      } else if (isLeaf && typeof en[oldKey] === 'string' && en[oldKey].trim()) {
        base = segmentFromText(en[oldKey], 6);
        stats.fromEnglishValue++;
      } else {
        base = segmentFromTerms(stem);
        stats.fromTerms++;
      }
      return plural ? `${base}_${plural}` : base;
    });

    let newKey = rebuilt.join('.');
    if (taken.has(newKey) && taken.get(newKey) !== oldKey) {
      // Two old keys landing on one name and saying exactly the same thing in all three languages
      // are one key that was written twice — `INVOICE.PDF.DESCRIPCION` and `INVOICE.PDF.DESCRIPTION`
      // both held "Descripción". Merging them is the point of the rename, not a collision to work
      // around: every reference to either name is rewritten to the one that survives.
      if (content(oldKey) === content(taken.get(newKey))) {
        stats.merged++;
        map[oldKey] = newKey;
        continue;
      }
      stats.collisions++;
      const english = en[oldKey];
      const [, plural] = splitPlural(segments[segments.length - 1]);
      if (typeof english === 'string' && english.trim()) {
        const parts = newKey.split('.');
        const longer = segmentFromText(english, 10);
        parts[parts.length - 1] = plural ? `${longer}_${plural}` : longer;
        newKey = parts.join('.');
      }
      // Still colliding: the English text matches but a translation does not, so they are two
      // distinct messages that happen to read alike in English. The old leaf is the only thing
      // left that tells them apart, appended as one more word rather than as a bare number.
      if (taken.has(newKey) && taken.get(newKey) !== oldKey) {
        const parts = newKey.split('.');
        parts[parts.length - 1] = `${parts[parts.length - 1]}_${normaliseSegment(segments[segments.length - 1])}`;
        newKey = parts.join('.');
      }
      let n = 2;
      while (taken.has(newKey) && taken.get(newKey) !== oldKey) newKey = `${newKey}_alt${n++}`;
    }
    taken.set(newKey, oldKey);
    map[oldKey] = newKey;
  }
}

const invalid = Object.entries(map).filter(([, k]) => !isValidKey(k));
fs.writeFileSync(`${HERE}/rename-map.json`, `${JSON.stringify(map, null, 0)}\n`);
console.log(`mapped ${Object.keys(map).length} keys`);
console.log(`  kept English segments ${stats.kept} · rebuilt from English value ${stats.fromEnglishValue} · from term map ${stats.fromTerms} · curated ${stats.curated}`);
console.log(`  duplicate keys merged ${stats.merged} · name collisions disambiguated ${stats.collisions}`);
const distinct = new Set(Object.values(map)).size;
console.log(`  ${Object.keys(map).length} old keys -> ${distinct} distinct new keys`);
if (invalid.length) {
  console.log(`\n${invalid.length} INVALID:`);
  invalid.slice(0, 25).forEach(([o, n]) => console.log(`   ${n}   (was ${o})`));
  process.exitCode = 1;
}
