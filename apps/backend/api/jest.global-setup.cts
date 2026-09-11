/**
 * Runs once before the whole backend test run.
 *
 * ## Why it exists
 *
 * The integration suites — the ones that prove the ledger's invariants, the period close, the
 * audit adjustment — guard themselves with `DB_AVAILABLE ? describe : describe.skip`, so a machine
 * with no Postgres skips them and still reports a green run. That is correct for a contributor who
 * only touched a stylesheet, but dangerous when it hides that the very tests protecting
 * double-entry integrity did not run. The suite was silent about it.
 *
 * This makes it loud: a single, unmissable banner naming what was skipped and how to run it. CI
 * sets `DB_HOST`/`DB_NAME`, so there the banner never appears and every suite runs for real.
 */
module.exports = async function globalSetup(): Promise<void> {
  const dbAvailable = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
  if (dbAvailable) return;

  const banner = [
    '',
    '  ┌───────────────────────────────────────────────────────────────────────────┐',
    '  │  ⚠  No database configured (DB_HOST / DB_NAME unset).                       │',
    '  │     Integration suites — ledger integrity, period close, reconciliation,   │',
    '  │     invoicing — will be SKIPPED, not run. A green result does not cover     │',
    '  │     them.                                                                   │',
    '  │                                                                             │',
    '  │     Run them locally with a throwaway database:                             │',
    '  │       docker compose -f docker-compose.test.yml up -d                       │',
    '  │       DB_HOST=localhost DB_NAME=virteex_test DB_USERNAME=postgres \\         │',
    '  │         DB_PASSWORD=postgres npx nx test api                                │',
    '  └───────────────────────────────────────────────────────────────────────────┘',
    '',
  ].join('\n');

  // eslint-disable-next-line no-console
  console.warn(banner);
};
