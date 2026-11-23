#!/usr/bin/env node
/**
 * The AI engine runs on one Python, and that is the one its lock is compiled for and its tests run in.
 *
 * The engine's tests used to run in whatever `python3` the CI runner had. When GitHub moved
 * `ubuntu-latest` to Ubuntu 26.04 (rolled out 19 Oct – 19 Nov 2026) that stopped being the Python
 * the worker ships with, and the locked install failed there (CI runs 494 and 498) — the image
 * itself was fine. The tests now run inside the image (`--target test` of `apps/ai-engine/Dockerfile`),
 * so what is tested is what is deployed. What can still drift is checked here:
 *
 *   - the interpreter is declared once, as `ARG PYTHON_VERSION`, and the base image is built from it;
 *   - `requirements.lock` was compiled for that same version (`--python-version` in its header);
 *   - `pyproject.toml`'s `requires-python` admits it;
 *   - the image has a `test` stage, and the LAST stage — what a build without `--target` produces,
 *     i.e. what is deployed — is the worker, running as a non-root user, never the tests.
 *
 *     node tools/verify/ai-engine-image.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENGINE = resolve(process.cwd(), 'apps/ai-engine');
const read = (name) => readFileSync(resolve(ENGINE, name), 'utf8');

const failures = [];
const fail = (message) => failures.push(message);

// ── The Dockerfile ──────────────────────────────────────────────────────────────────────────────
// Instructions, with line continuations joined and comments dropped.
const instructions = read('Dockerfile')
  .replace(/\\\r?\n/g, ' ')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

const firstFrom = instructions.findIndex((line) => /^FROM\s/i.test(line));
const versionArg = instructions
  .slice(0, firstFrom === -1 ? instructions.length : firstFrom)
  .map((line) => line.match(/^ARG\s+PYTHON_VERSION=(\S+)$/i))
  .find(Boolean);
const pythonVersion = versionArg?.[1];
if (!pythonVersion) {
  fail('Dockerfile: declare the interpreter once, as `ARG PYTHON_VERSION=<major.minor>` before the first FROM.');
} else if (!/^3\.\d+$/.test(pythonVersion)) {
  fail(`Dockerfile: PYTHON_VERSION must be a major.minor version (got ${pythonVersion}); the lock is compiled per minor version.`);
}

const stages = [];
for (const line of instructions) {
  const from = line.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?$/i);
  if (from) {
    stages.push({ image: from[1], name: from[2] ?? null, user: null });
    continue;
  }
  const user = line.match(/^USER\s+(\S+)$/i);
  if (user && stages.length > 0) stages[stages.length - 1].user = user[1];
}

if (stages.length === 0) {
  fail('Dockerfile: no FROM.');
} else {
  const external = stages.filter((stage) => !stages.some((other) => other.name && other.name === stage.image));
  for (const stage of external) {
    if (!/^python:\$\{PYTHON_VERSION\}-slim(@sha256:[0-9a-f]{64})?$/.test(stage.image)) {
      fail(`Dockerfile: the base image must be built from the declared version, \`python:\${PYTHON_VERSION}-slim\` (got ${stage.image}).`);
    }
  }
  if (!stages.some((stage) => stage.name === 'test')) {
    fail('Dockerfile: no `test` stage — CI runs the engine\'s tests in the image (`docker build --target test`).');
  }
  const last = stages[stages.length - 1];
  if (last.name === 'test') {
    fail('Dockerfile: the last stage is `test`, so a build without `--target` would deploy the tests. Put the worker stage last.');
  }
  // The user a stage runs as is the last USER in it or in the stages it is built from.
  const userOf = (stage) => {
    if (stage.user) return stage.user;
    const parent = stages.find((other) => other.name && other.name === stage.image);
    return parent ? userOf(parent) : null;
  };
  const runtimeUser = userOf(last);
  if (!runtimeUser || runtimeUser === 'root' || runtimeUser === '0') {
    fail(`Dockerfile: the deployed stage (${last.name ?? 'last'}) must run as a non-root USER.`);
  }
}

// ── The lock ────────────────────────────────────────────────────────────────────────────────────
const lockVersion = read('requirements.lock').match(/--python-version[ =](\S+)/)?.[1];
if (!lockVersion) {
  fail('requirements.lock: its header does not say which Python it was compiled for (`uv pip compile … --python-version X.Y`).');
} else if (pythonVersion && lockVersion !== pythonVersion) {
  fail(
    `requirements.lock was compiled for Python ${lockVersion}, the image runs ${pythonVersion}. Recompile it: ` +
      `uv pip compile pyproject.toml --python-version ${pythonVersion} --extra dev -o requirements.lock`,
  );
}

// ── pyproject.toml ──────────────────────────────────────────────────────────────────────────────
const requires = read('pyproject.toml').match(/^requires-python\s*=\s*"([^"]+)"/m)?.[1];
const parse = (version) => version.split('.').map(Number);
const compare = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
};
if (!requires) {
  fail('pyproject.toml: declare `requires-python`.');
} else if (pythonVersion) {
  for (const clause of requires.split(',').map((part) => part.trim()).filter(Boolean)) {
    const match = clause.match(/^(>=|<=|==|!=|>|<|~=)\s*([0-9.]+)$/);
    if (!match) {
      fail(`pyproject.toml: cannot read the requires-python clause "${clause}".`);
      continue;
    }
    const [, op, bound] = match;
    const c = compare(pythonVersion, bound);
    const ok = {
      '>=': c >= 0,
      '<=': c <= 0,
      '>': c > 0,
      '<': c < 0,
      '==': c === 0,
      '!=': c !== 0,
      '~=': c >= 0 && parse(pythonVersion)[0] === parse(bound)[0],
    }[op];
    if (!ok) fail(`pyproject.toml: requires-python "${requires}" does not admit the image's Python ${pythonVersion}.`);
  }
}

if (failures.length > 0) {
  console.error('✗ The AI engine\'s interpreter, lock and image disagree:\n');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(
  `✓ AI engine: Python ${pythonVersion} for the image, the lock and requires-python ("${requires}"); ` +
    `stages ${stages.map((stage) => stage.name ?? '?').join(' → ')}, the deployed one runs as a non-root user.`,
);
