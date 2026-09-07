import { DataSource, QueryFailedError } from 'typeorm';

/**
 * The ledger's invariants, asserted against the database rather than against the service.
 *
 * ## Why this suite is raw SQL
 *
 * `ledger-integrity.spec.ts` proves that `JournalEntriesService` refuses to write a bad entry.
 * That is a property of one code path. The question here is different and larger: can a bad entry
 * exist *at all* — written by a migration, a future service, a support engineer with `psql`, an
 * ORM call that skips the service, a job somebody adds next year?
 *
 * Every accounting invariant lived exclusively in TypeScript. The consequence is not theoretical:
 * the general ledger is the record a tax authority and an auditor rely on, and "the code that
 * writes it is careful" is a weaker guarantee than "the shape is impossible". So the checks moved
 * into the schema, and this suite bypasses the application entirely to prove they hold there.
 *
 * Going through the services would defeat the point — the answer would be about the services again.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

const ORG = '9a000000-0000-4000-8000-000000000001';
const LEDGER = '9a000000-0000-4000-8000-000000000002';
const LEDGER_IFRS = '9a000000-0000-4000-8000-000000000003';
const JOURNAL = '9a000000-0000-4000-8000-000000000004';
const CASH = '9a000000-0000-4000-8000-000000000005';
const REVENUE = '9a000000-0000-4000-8000-000000000006';

describeWithDb('ledger invariants (enforced by the database)', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let entryCounter = 0;

  const nextEntryId = () =>
    `9a000000-0000-4000-8000-1${String(++entryCounter).padStart(11, '0')}`;

  /** Insert an entry in the given status and return its id. */
  const seedEntry = async (status = 'Posted'): Promise<string> => {
    const id = nextEntryId();
    await dataSource.query(
      `INSERT INTO journal_entries
         (id, organization_id, ledger_id, journal_id, date, description, status)
       VALUES ($1, $2, $3, $4, '2026-01-15', 'prueba', $5)`,
      [id, ORG, LEDGER, JOURNAL, status],
    );
    return id;
  };

  /** A balanced pair of lines with their primary valuations, inside one transaction. */
  const postBalancedPair = async (
    entryId: string,
    amount: number,
    valuation = amount,
  ): Promise<{ debitLine: string; creditLine: string }> => {
    const debitLine = nextEntryId().replace('-1', '-2');
    const creditLine = nextEntryId().replace('-1', '-3');
    await dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit)
         VALUES ($1, $3, $5, $4, 0), ($2, $3, $6, 0, $4)`,
        [debitLine, creditLine, entryId, amount, CASH, REVENUE],
      );
      await manager.query(
        `INSERT INTO journal_entry_line_valuations (journal_entry_line_id, ledger_id, debit, credit)
         VALUES ($1, $3, $4, 0), ($2, $3, 0, $4)`,
        [debitLine, creditLine, LEDGER, valuation],
      );
    });
    return { debitLine, creditLine };
  };

  const message = (error: unknown): string =>
    error instanceof QueryFailedError ? error.message : String(error);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();

    await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [ORG]);
    await dataSource.query(
      `INSERT INTO organizations (id, legal_name) VALUES ($1, 'Invariantes S.R.L.')`,
      [ORG],
    );
    await dataSource.query(
      `INSERT INTO ledgers (id, organization_id, name, currency, is_default)
       VALUES ($1, $3, 'Principal', 'USD', true), ($2, $3, 'IFRS', 'USD', false)`,
      [LEDGER, LEDGER_IFRS, ORG],
    );
    await dataSource.query(
      `INSERT INTO journals (id, organization_id, code, name, type)
       VALUES ($1, $2, 'GEN', 'General', 'GENERAL')`,
      [JOURNAL, ORG],
    );
    await dataSource.query(
      `INSERT INTO accounts
         (id, organization_id, code, name, type, category, nature, version, "isPostable")
       VALUES
         ($1, $3, '1000', '{"es":"Caja"}', 'ASSET', 'CURRENT_ASSET', 'DEBIT', 1, true),
         ($2, $3, '4000', '{"es":"Ventas"}', 'REVENUE', 'OPERATING_REVENUE', 'CREDIT', 1, true)`,
      [CASH, REVENUE, ORG],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [ORG]);
      await dataSource.destroy();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Sign and exclusivity
  // ───────────────────────────────────────────────────────────────────────────

  describe('a line carries a debit or a credit', () => {
    it('refuses a line with both', async () => {
      const entry = await seedEntry();
      await expect(
        dataSource.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
           VALUES ($1, $2, 10, 10)`,
          [entry, CASH],
        ),
      ).rejects.toThrow(/CHK_journal_entry_lines_sign/);
    });

    it('refuses a negative amount', async () => {
      const entry = await seedEntry();
      await expect(
        dataSource.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
           VALUES ($1, $2, -10, 0)`,
          [entry, CASH],
        ),
      ).rejects.toThrow(/CHK_journal_entry_lines_sign/);
    });

    it('refuses a line with no amount at all', async () => {
      const entry = await seedEntry();
      await expect(
        dataSource.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
           VALUES ($1, $2, 0, 0)`,
          [entry, CASH],
        ),
      ).rejects.toThrow(/CHK_journal_entry_lines_sign/);
    });

    it('refuses a negative document-currency amount', async () => {
      const entry = await seedEntry();
      await expect(
        dataSource.query(
          `INSERT INTO journal_entry_lines
             (journal_entry_id, account_id, debit, credit, foreign_currency_debit)
           VALUES ($1, $2, 10, 0, -10)`,
          [entry, CASH],
        ),
      ).rejects.toThrow(/CHK_journal_entry_lines_foreign_sign/);
    });

    it('refuses an exchange rate of zero', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO journal_entries
             (organization_id, ledger_id, journal_id, date, description, status,
              currency_code, exchange_rate)
           VALUES ($1, $2, $3, '2026-01-15', 'tasa cero', 'Posted', 'EUR', 0)`,
          [ORG, LEDGER, JOURNAL],
        ),
      ).rejects.toThrow(/CHK_journal_entries_exchange_rate_positive/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Double entry
  // ───────────────────────────────────────────────────────────────────────────

  describe('double entry, on the table the balances come from', () => {
    it('accepts an entry whose valuations balance', async () => {
      const entry = await seedEntry();
      await expect(postBalancedPair(entry, 100)).resolves.toBeDefined();
    });

    /**
     * The case the application could not see.
     *
     * Every balance in the product is a `SUM` over `journal_entry_line_valuations`. The service's
     * own checks summed `journal_entry_lines.debit`, a column no report reads — so lines that
     * balanced and valuations that did not passed every check and put the general ledger
     * permanently out of balance.
     */
    it('refuses an entry whose LINES balance but whose VALUATIONS do not', async () => {
      const entry = await seedEntry();
      const attempt = dataSource.transaction(async (manager) => {
        const debitLine = nextEntryId().replace('-1', '-4');
        const creditLine = nextEntryId().replace('-1', '-5');
        await manager.query(
          `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit)
           VALUES ($1, $3, $4, 100, 0), ($2, $3, $5, 0, 100)`,
          [debitLine, creditLine, entry, CASH, REVENUE],
        );
        await manager.query(
          `INSERT INTO journal_entry_line_valuations
             (journal_entry_line_id, ledger_id, debit, credit)
           VALUES ($1, $3, 100, 0), ($2, $3, 0, 99)`,
          [debitLine, creditLine, LEDGER],
        );
      });

      await expect(attempt).rejects.toThrow(/no balancea en el libro/);
    });

    /**
     * Multi-GAAP. Mapping rules are keyed by (ledger, account), so a rule on some of an entry's
     * accounts and not the rest derives a partial — and structurally unbalanced — entry into the
     * secondary book. Checking the entry "in aggregate" would not see it.
     */
    it('refuses an entry that balances in the primary ledger but not in a secondary one', async () => {
      const entry = await seedEntry();
      const attempt = dataSource.transaction(async (manager) => {
        const debitLine = nextEntryId().replace('-1', '-6');
        const creditLine = nextEntryId().replace('-1', '-7');
        await manager.query(
          `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit)
           VALUES ($1, $3, $4, 100, 0), ($2, $3, $5, 0, 100)`,
          [debitLine, creditLine, entry, CASH, REVENUE],
        );
        await manager.query(
          `INSERT INTO journal_entry_line_valuations
             (journal_entry_line_id, ledger_id, debit, credit)
           VALUES ($1, $3, 100, 0), ($2, $3, 0, 100), ($1, $4, 100, 0)`,
          [debitLine, creditLine, LEDGER, LEDGER_IFRS],
        );
      });

      await expect(attempt).rejects.toThrow(/no balancea en el libro/);
    });

    /** A line valued in no ledger is in the book and in nobody's balance. */
    it('refuses a line with no valuation at all', async () => {
      const entry = await seedEntry();
      const attempt = dataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
           VALUES ($1, $2, 5, 0)`,
          [entry, CASH],
        );
      });
      await expect(attempt).rejects.toThrow(/no tiene valoración en ningún libro/);
    });

    /**
     * The check has to be deferred: an entry is written line by line and is legitimately
     * unbalanced in the middle of the transaction that creates it. A non-deferred trigger would
     * reject every entry ever written.
     */
    it('permits an entry to be unbalanced mid-transaction and balanced by COMMIT', async () => {
      const entry = await seedEntry();
      const attempt = dataSource.transaction(async (manager) => {
        const debitLine = nextEntryId().replace('-1', '-8');
        const creditLine = nextEntryId().replace('-1', '-9');
        await manager.query(
          `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit)
           VALUES ($1, $2, $3, 100, 0)`,
          [debitLine, entry, CASH],
        );
        await manager.query(
          `INSERT INTO journal_entry_line_valuations
             (journal_entry_line_id, ledger_id, debit, credit)
           VALUES ($1, $2, 100, 0)`,
          [debitLine, LEDGER],
        );
        // Out of balance right here, and that is fine.
        await manager.query(
          `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit)
           VALUES ($1, $2, $3, 0, 100)`,
          [creditLine, entry, REVENUE],
        );
        await manager.query(
          `INSERT INTO journal_entry_line_valuations
             (journal_entry_line_id, ledger_id, debit, credit)
           VALUES ($1, $2, 0, 100)`,
          [creditLine, LEDGER],
        );
      });
      await expect(attempt).resolves.toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Immutability
  // ───────────────────────────────────────────────────────────────────────────

  describe('a posted record does not change', () => {
    it('refuses to change the date of a posted entry', async () => {
      const entry = await seedEntry();
      await postBalancedPair(entry, 100);
      await expect(
        dataSource.query(`UPDATE journal_entries SET date = '2026-02-01' WHERE id = $1`, [entry]),
      ).rejects.toThrow(/No se puede modificar un asiento contabilizado/);
    });

    it('refuses to change the amount of a posted line', async () => {
      const entry = await seedEntry();
      const { debitLine } = await postBalancedPair(entry, 100);
      await expect(
        dataSource.query(`UPDATE journal_entry_lines SET debit = 999 WHERE id = $1`, [debitLine]),
      ).rejects.toThrow(/No se puede modificar la línea/);
    });

    it('refuses to change a posted valuation — the balance itself', async () => {
      const entry = await seedEntry();
      const { debitLine } = await postBalancedPair(entry, 100);
      await expect(
        dataSource.query(
          `UPDATE journal_entry_line_valuations SET debit = 999
           WHERE journal_entry_line_id = $1`,
          [debitLine],
        ),
      ).rejects.toThrow(/No se puede alterar la valoración/);
    });

    it('refuses to delete a posted entry', async () => {
      const entry = await seedEntry();
      await postBalancedPair(entry, 100);
      await expect(
        dataSource.query(`DELETE FROM journal_entries WHERE id = $1`, [entry]),
      ).rejects.toThrow(/No se puede eliminar un asiento contabilizado/);
    });

    it('refuses to delete a posted line', async () => {
      const entry = await seedEntry();
      const { debitLine } = await postBalancedPair(entry, 100);
      await expect(
        dataSource.query(`DELETE FROM journal_entry_lines WHERE id = $1`, [debitLine]),
      ).rejects.toThrow(/No se puede eliminar la línea/);
    });

    it('refuses an illegal status transition out of Posted', async () => {
      const entry = await seedEntry();
      await postBalancedPair(entry, 100);
      await expect(
        dataSource.query(`UPDATE journal_entries SET status = 'Draft' WHERE id = $1`, [entry]),
      ).rejects.toThrow(/no puede cambiar de estado/);
    });

    // ── What a correction IS allowed to do ──────────────────────────────────

    it('permits marking a posted entry reversed and superseded', async () => {
      const entry = await seedEntry();
      await postBalancedPair(entry, 100);
      await expect(
        dataSource.query(
          `UPDATE journal_entries
           SET is_reversed = true, status = 'Modified', modification_reason = 'corrección'
           WHERE id = $1`,
          [entry],
        ),
      ).resolves.toBeDefined();
    });

    it('permits clearing a posted line against a bank statement', async () => {
      const entry = await seedEntry();
      const { debitLine } = await postBalancedPair(entry, 100);
      await expect(
        dataSource.query(
          `UPDATE journal_entry_lines SET is_reconciled = true, reconciled_at = now()
           WHERE id = $1`,
          [debitLine],
        ),
      ).resolves.toBeDefined();
    });

    it('leaves a draft entry entirely editable', async () => {
      const entry = await seedEntry('Draft');
      await expect(
        dataSource.query(
          `UPDATE journal_entries SET date = '2026-03-01', description = 'otra' WHERE id = $1`,
          [entry],
        ),
      ).resolves.toBeDefined();
      await expect(
        dataSource.query(`DELETE FROM journal_entries WHERE id = $1`, [entry]),
      ).resolves.toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Idempotency
  // ───────────────────────────────────────────────────────────────────────────

  describe('a business fact is booked once', () => {
    it('refuses a second entry with the same idempotency key in the same tenant', async () => {
      const first = nextEntryId();
      const second = nextEntryId();
      const key = `invoice:${first}:revenue`;
      await dataSource.query(
        `INSERT INTO journal_entries
           (id, organization_id, ledger_id, journal_id, date, description, status, idempotency_key)
         VALUES ($1, $2, $3, $4, '2026-01-15', 'primera', 'Posted', $5)`,
        [first, ORG, LEDGER, JOURNAL, key],
      );
      await expect(
        dataSource.query(
          `INSERT INTO journal_entries
             (id, organization_id, ledger_id, journal_id, date, description, status, idempotency_key)
           VALUES ($1, $2, $3, $4, '2026-01-15', 'repetida', 'Posted', $5)`,
          [second, ORG, LEDGER, JOURNAL, key],
        ),
      ).rejects.toThrow(/IDX_journal_entries_org_idempotency_key/);
    });

    it('leaves entries without a key unconstrained', async () => {
      await expect(seedEntry()).resolves.toBeDefined();
      await expect(seedEntry()).resolves.toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The guards do not block legitimate operations
  // ───────────────────────────────────────────────────────────────────────────

  describe('deleting a tenant', () => {
    /**
     * The delete guards ask whether the owning row still exists rather than consulting a session
     * flag somebody has to remember to set. `DELETE FROM organizations` removes the parent first,
     * so the cascade reaches the ledger with the organization already gone.
     */
    it('still cascades through a posted ledger', async () => {
      const doomed = '9a000000-0000-4000-8000-00000000000f';
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [doomed]);
      await dataSource.query(
        `INSERT INTO organizations (id, legal_name) VALUES ($1, 'Para borrar')`,
        [doomed],
      );
      const ledger = '9a000000-0000-4000-8000-00000000001f';
      const journal = '9a000000-0000-4000-8000-00000000002f';
      const account = '9a000000-0000-4000-8000-00000000003f';
      const account2 = '9a000000-0000-4000-8000-00000000004f';
      const entry = '9a000000-0000-4000-8000-00000000005f';
      const lineA = '9a000000-0000-4000-8000-00000000006f';
      const lineB = '9a000000-0000-4000-8000-00000000007f';

      await dataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO ledgers (id, organization_id, name, currency, is_default)
           VALUES ($1, $2, 'GL', 'USD', true)`,
          [ledger, doomed],
        );
        await manager.query(
          `INSERT INTO journals (id, organization_id, code, name, type)
           VALUES ($1, $2, 'GEN', 'General', 'GENERAL')`,
          [journal, doomed],
        );
        await manager.query(
          `INSERT INTO accounts
             (id, organization_id, code, name, type, category, nature, version, "isPostable")
           VALUES
             ($1, $3, '1000', '{"es":"Caja"}', 'ASSET', 'CURRENT_ASSET', 'DEBIT', 1, true),
             ($2, $3, '4000', '{"es":"Ventas"}', 'REVENUE', 'OPERATING_REVENUE', 'CREDIT', 1, true)`,
          [account, account2, doomed],
        );
        await manager.query(
          `INSERT INTO journal_entries
             (id, organization_id, ledger_id, journal_id, date, description, status)
           VALUES ($1, $2, $3, $4, '2026-01-15', 'a borrar', 'Posted')`,
          [entry, doomed, ledger, journal],
        );
        await manager.query(
          `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit)
           VALUES ($1, $3, $4, 50, 0), ($2, $3, $5, 0, 50)`,
          [lineA, lineB, entry, account, account2],
        );
        await manager.query(
          `INSERT INTO journal_entry_line_valuations
             (journal_entry_line_id, ledger_id, debit, credit)
           VALUES ($1, $3, 50, 0), ($2, $3, 0, 50)`,
          [lineA, lineB, ledger],
        );
      });

      await expect(
        dataSource.query(`DELETE FROM organizations WHERE id = $1`, [doomed]),
      ).resolves.toBeDefined();

      const remaining = await dataSource.query(
        `SELECT count(*)::int AS n FROM journal_entries WHERE organization_id = $1`,
        [doomed],
      );
      expect(remaining[0].n).toBe(0);
    });
  });

  it('reports which ledger failed, not merely that something failed', async () => {
    const entry = await seedEntry();
    try {
      await dataSource.transaction(async (manager) => {
        const line = nextEntryId().replace('-1', '-a');
        await manager.query(
          `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit)
           VALUES ($1, $2, $3, 7, 0)`,
          [line, entry, CASH],
        );
        await manager.query(
          `INSERT INTO journal_entry_line_valuations
             (journal_entry_line_id, ledger_id, debit, credit)
           VALUES ($1, $2, 7, 0)`,
          [line, LEDGER],
        );
      });
      throw new Error('expected the entry to be refused');
    } catch (error) {
      expect(message(error)).toContain(LEDGER);
      expect(message(error)).toMatch(/débitos 7\.00, créditos 0\.00/);
    }
  });
});
