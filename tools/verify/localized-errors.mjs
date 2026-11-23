#!/usr/bin/env node
/**
 * Every refusal the API gives is a KEY, never a sentence.
 *
 * The contract (`i18n/i18n-exception.filter.ts`, `libs/shared/ui-i18n/src/lib/error-key.ts`): a
 * failure comes back as `{ statusCode, code, messageKey, params }` and the browser renders the
 * catalogue entry in the reader's language. A `throw new BadRequestException('La naturaleza de la
 * cuenta…')` breaks it twice over — the reader gets Spanish whatever language they chose, and the
 * sentence cannot be changed without a release.
 *
 * So raw Nest HTTP exceptions are allowed in exactly two shapes:
 *
 *  - with NO argument or with a MACHINE CODE (`AuthError.SESSION_EXPIRED` → `AUTH_SESSION_EXPIRED`),
 *    which the filter recognises and turns into `errors.auth_session_expired`. That is how the auth
 *    surface has always spoken and the client branches on those codes;
 *  - with a BODY THAT IS THE CONTRACT: an object carrying `messageKey`, which is what
 *    `UuidParamPipe` hands the filter so a malformed id comes back as a field error. The shape is
 *    the contract spelled out rather than bypassed;
 *  - inside `i18n/`, which is the machinery that produces the contract in the first place.
 *
 * Anything else — a string literal, a template literal, an object with prose in it — is a sentence
 * escaping to a browser, and this fails.
 *
 *     npm run verify:localized-errors
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const SOURCES = [
  join(ROOT, 'apps/backend/api/src/app'),
  join(ROOT, 'apps/backend/ai-engine'),
];

/** The classes that serialise straight to an HTTP body without passing through the catalogue. */
const RAW = [
  'BadRequestException',
  'UnauthorizedException',
  'ForbiddenException',
  'NotFoundException',
  'ConflictException',
  'GoneException',
  'PreconditionFailedException',
  'UnprocessableEntityException',
  'InternalServerErrorException',
  'ServiceUnavailableException',
  'HttpException',
];

/** Where the contract is implemented, and where a spec asserts it. */
const EXEMPT = [/\/i18n\//, /\.spec\.ts$/, /\.testing\.ts$/, /\/testing\//];

/** `new XException()` or `new XException(SOME_CODE)` / `new XException(AuthError.X)`. */
const ALLOWED_ARGUMENT = /^\s*$|^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*$/;
const CODE_SHAPE = /^[A-Z][A-Z0-9_]{2,}$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') walk(full, out);
    } else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const offences = [];
for (const dir of SOURCES) {
  let files;
  try {
    files = walk(dir);
  } catch {
    continue; // an application that is not in this checkout
  }
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (EXEMPT.some((rx) => rx.test(`/${rel}`))) continue;
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      for (const name of RAW) {
        const at = line.indexOf(`new ${name}(`);
        if (at === -1) continue;
        const start = at + `new ${name}(`.length;
        const sameLine = line.slice(start, line.lastIndexOf(')') === -1 ? undefined : line.lastIndexOf(')'));
        // An identifier is a code (`AuthError.SESSION_EXPIRED`, `code`); a literal is a sentence.
        if (ALLOWED_ARGUMENT.test(sameLine) || CODE_SHAPE.test(sameLine.trim().replace(/^['"]|['"]$/g, ''))) continue;
        // An object spelling out the response contract: read to the end of the call.
        if (sameLine.trim() === '{') {
          const body = lines.slice(index, index + 20).join('\n');
          if (/\bmessageKey\s*:/.test(body)) continue;
        }
        offences.push(`${rel}:${index + 1}  new ${name}(${sameLine.trim().slice(0, 70)}…)`);
      }
    });
  }
}

if (offences.length > 0) {
  console.error(`✗ ${offences.length} refusal(s) carry a sentence instead of a key:\n`);
  for (const line of offences) console.error(`   ${line}`);
  console.error(
    '\n  Throw a localized error instead (`BadRequestError(\'module.key\', params)`, see\n' +
      '  i18n/localized.exception.ts), or a bare Nest exception carrying a machine code.',
  );
  process.exit(1);
}
console.log('localized errors: every API refusal travels as a key, not as a sentence.');
