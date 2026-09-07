import { DataSource } from 'typeorm';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Journal } from './entities/journal.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import {
  AccountCategory,
  AccountNature,
  AccountType,
} from '../chart-of-accounts/enums/account-enums';
import { AccountingPeriod, PeriodStatus } from '../accounting/entities/accounting-period.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryAttachment } from './entities/journal-entry-attachment.entity';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntryNumberingService } from './journal-entry-numbering.service';
import { JournalEntryImportService } from './journal-entry-import.service';
import {
  ImportBatchStatus,
  JournalEntryImportBatch,
} from './entities/journal-entry-import-batch.entity';
import { FileParserService } from './parsers/file-parser.service';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { PreviewImportRequestDto } from './dto/journal-entry-import.dto';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';

/**
 * Importing a journal from a file.
 *
 * ## What each of these used to do
 *
 * `parseFloat(row[column] || '0')` for the amounts: `1.234,56` — the ordinary way of writing money
 * in most of Latin America — became **1.234**, and the entry still balanced because both of its
 * sides were divided by the same thousand. Nothing downstream could notice.
 *
 * `new Date(row[dateColumn]).toISOString()` for the date: `03/04/2026` is 4 March in the United
 * States and 3 April almost everywhere else, and the file said which nowhere. An unreadable date
 * threw `RangeError` out of `toISOString`, which reached the caller as a 500.
 *
 * `Math.abs(totalDebit - totalCredit) < 0.01` over `+=`-accumulated floats for the balance check:
 * an entry genuinely out by up to a cent was imported into a double-entry ledger as balanced.
 *
 * And the batch itself lived in a module-scope `Map`, so with more than one instance — which is
 * every real deployment — the confirm landed on a pod that had never heard of it.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('journal entry import', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let importer: JournalEntryImportService;

  let organizationId: string;
  let ledgerId: string;
  const account: Record<string, string> = {};

  const ACTOR = '77777777-7777-4777-8777-777777777777';
  const OTHER_USER = '88888888-8888-4888-8888-888888888888';

  /** The rows the stubbed file parser will hand back, set per test. */
  let parsedRows: Record<string, string>[] = [];

  const mapping: PreviewImportRequestDto = {
    columnMapping: {
      entryId: 'Asiento',
      date: 'Fecha',
      description: 'Concepto',
      accountCode: 'Cuenta',
      debit: 'Debe',
      credit: 'Haber',
      lineDescription: 'Detalle',
    },
    dateFormat: 'dd/MM/yyyy',
    decimalSeparator: ',',
  };

  const FILE = { mimetype: 'text/csv' } as FastifyFile;

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
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();

    const organization = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Importación ${Date.now()}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = organization.id;

    await dataSource.getRepository(OrganizationSettings).save({ organizationId, baseCurrency: 'DOP' });

    const ledger = await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({
        organizationId,
        name: 'Principal',
        currency: 'DOP',
        isDefault: true,
      }),
    );
    ledgerId = ledger.id;

    await dataSource
      .getRepository(Journal)
      .save([{ organizationId, code: 'GENERAL', name: 'Diario general', type: 'GENERAL' as const }]);

    const make = async (
      key: string,
      code: string,
      type: AccountType,
      category: AccountCategory,
      nature: AccountNature,
      options: { isPostable?: boolean; isActive?: boolean } = {},
    ) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code,
          name: { es: code },
          type,
          category,
          nature,
          isPostable: options.isPostable ?? true,
          isActive: options.isActive ?? true,
        }),
      );
      account[key] = saved.id;
    };

    await make('cash', '1101', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('bank', '1102', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('revenue', '4100', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, AccountNature.CREDIT);
    await make('grouping', '11', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, { isPostable: false });
    await make('closed', '1109', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, { isActive: false });

    await dataSource.getRepository(AccountingPeriod).save([
      {
        organizationId,
        name: 'Marzo 2026',
        startDate: '2026-03-01' as unknown as Date,
        endDate: '2026-03-31' as unknown as Date,
        status: PeriodStatus.OPEN,
      },
    ]);

    const audit = new AuditTrailService(dataSource.getRepository(AuditLog));
    const entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null) } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      audit,
      new ExchangeRateResolver(dataSource),
    );

    const fileParser = {
      parse: jest.fn(async () => ({ headers: Object.keys(parsedRows[0] ?? {}), data: parsedRows })),
    } as unknown as FileParserService;

    importer = new JournalEntryImportService(
      dataSource.getRepository(Account),
      dataSource.getRepository(JournalEntryImportBatch),
      entries,
      dataSource,
      fileParser,
      { sendToUser: jest.fn() } as never,
    );
  });

  afterAll(async () => {
    await dataSource?.getRepository(Organization).delete({ id: organizationId });
    await dataSource?.destroy();
  });

  /** One well-formed entry: 58,750.00 out of the bank, into revenue. */
  const balancedRows = () => [
    { Asiento: 'A1', Fecha: '10/03/2026', Concepto: 'Venta del día', Cuenta: '1102', Debe: '58.750,00', Haber: '', Detalle: 'Cobro' },
    { Asiento: 'A1', Fecha: '10/03/2026', Concepto: 'Venta del día', Cuenta: '4100', Debe: '', Haber: '58.750,00', Detalle: 'Ingreso' },
  ];

  const preview = (rows: Record<string, string>[], userId = ACTOR) => {
    parsedRows = rows;
    return importer.preview(FILE, mapping, organizationId, userId);
  };

  describe('amounts', () => {
    /**
     * `parseFloat('58.750,00')` is 58.75. The entry balanced at 58.75 against 58.75, so the import
     * succeeded and the ledger was out by a factor of a thousand on both sides.
     */
    it('reads a grouped amount in the declared convention, not as parseFloat would', async () => {
      expect(parseFloat('58.750,00')).toBe(58.75);

      const result = await preview(balancedRows());
      expect(result.validEntriesCount).toBe(1);
      expect(result.previews[0].totalDebit).toBe(58_750);
      expect(result.previews[0].totalCredit).toBe(58_750);
    });

    it('refuses an amount it cannot read, instead of treating it as a number', async () => {
      const rows = balancedRows();
      rows[0]['Debe'] = '58750abc';

      const result = await preview(rows);
      expect(result.validEntriesCount).toBe(0);
      expect(result.previews[0].rows[0].error?.messageKey).toBe(
        'JOURNAL_ENTRIES.IMPORT.IMPORTE_NO_LEGIBLE',
      );
    });

    it('refuses a line carrying both a debit and a credit', async () => {
      const rows = balancedRows();
      rows[0]['Haber'] = '1,00';

      const result = await preview(rows);
      expect(result.previews[0].rows[0].error?.messageKey).toBe(
        'JOURNAL_ENTRIES.IMPORT.LINEA_CON_AMBOS_LADOS',
      );
    });

    it('refuses a negative amount rather than reversing the line silently', async () => {
      const rows = balancedRows();
      rows[0]['Debe'] = '-58.750,00';

      const result = await preview(rows);
      expect(result.previews[0].rows[0].error?.messageKey).toBe(
        'JOURNAL_ENTRIES.IMPORT.IMPORTE_NEGATIVO',
      );
    });
  });

  describe('balance', () => {
    /**
     * `Math.abs(d - c) < 0.01` accepted this. A cent is not a rounding artefact in a double-entry
     * ledger — it is the whole thing the ledger guarantees.
     */
    it('refuses an entry out by a single cent', async () => {
      const rows = balancedRows();
      rows[1]['Haber'] = '58.749,99';

      const result = await preview(rows);
      expect(result.validEntriesCount).toBe(0);
      expect(result.previews[0].isBalanced).toBe(false);
      expect(result.previews[0].errors.map((error) => error.messageKey)).toContain(
        'JOURNAL_ENTRIES.IMPORT.ASIENTO_NO_CUADRA',
      );
    });

    it('accepts an entry that balances exactly', async () => {
      const result = await preview(balancedRows());
      expect(result.previews[0].isBalanced).toBe(true);
      expect(result.invalidEntriesCount).toBe(0);
    });
  });

  describe('dates', () => {
    /**
     * `new Date('03/04/2026')` is 4 March in the United States and 3 April almost everywhere else.
     * The declared format is what settles it.
     */
    it('reads the date in the format the caller declared', async () => {
      const rows = balancedRows();
      for (const row of rows) row['Fecha'] = '03/03/2026';

      const result = await preview(rows);
      expect(result.validEntriesCount).toBe(1);

      const batch = await dataSource
        .getRepository(JournalEntryImportBatch)
        .findOneByOrFail({ id: result.batchId });
      expect(batch.entries[0].date).toBe('2026-03-03');
    });

    it('reads the same digits as a United States date when told to', async () => {
      const rows = balancedRows();
      for (const row of rows) row['Fecha'] = '03/10/2026';

      parsedRows = rows;
      const result = await importer.preview(
        FILE,
        { ...mapping, dateFormat: 'MM/dd/yyyy' },
        organizationId,
        ACTOR,
      );

      const batch = await dataSource
        .getRepository(JournalEntryImportBatch)
        .findOneByOrFail({ id: result.batchId });
      expect(batch.entries[0].date).toBe('2026-03-10');
    });

    /** This used to throw `RangeError` out of `toISOString()` — a 500 for a typo. */
    it('reports an unreadable date instead of failing the request', async () => {
      const rows = balancedRows();
      for (const row of rows) row['Fecha'] = 'no es una fecha';

      const result = await preview(rows);
      expect(result.validEntriesCount).toBe(0);
      expect(result.previews[0].errors.map((error) => error.messageKey)).toContain(
        'JOURNAL_ENTRIES.IMPORT.FECHA_NO_LEGIBLE',
      );
    });

    it('refuses 31 February rather than rolling it into March', async () => {
      const rows = balancedRows();
      for (const row of rows) row['Fecha'] = '31/02/2026';

      const result = await preview(rows);
      expect(result.previews[0].errors.map((error) => error.messageKey)).toContain(
        'JOURNAL_ENTRIES.IMPORT.FECHA_NO_LEGIBLE',
      );
    });
  });

  describe('accounts', () => {
    it('refuses a code that is not in the chart', async () => {
      const rows = balancedRows();
      rows[0]['Cuenta'] = '9999';

      const result = await preview(rows);
      expect(result.previews[0].rows[0].error).toEqual({
        messageKey: 'JOURNAL_ENTRIES.IMPORT.CUENTA_NO_EXISTE',
        params: { code: '9999' },
      });
    });

    /** Nothing checked this: an import could post to a grouping account, which no other path allows. */
    it('refuses a grouping account, which cannot take movements', async () => {
      const rows = balancedRows();
      rows[0]['Cuenta'] = '11';

      const result = await preview(rows);
      expect(result.previews[0].rows[0].error?.messageKey).toBe(
        'JOURNAL_ENTRIES.IMPORT.CUENTA_NO_ADMITE_MOVIMIENTOS',
      );
    });

    it('refuses an account somebody deactivated', async () => {
      const rows = balancedRows();
      rows[0]['Cuenta'] = '1109';

      const result = await preview(rows);
      expect(result.previews[0].rows[0].error?.messageKey).toBe(
        'JOURNAL_ENTRIES.IMPORT.CUENTA_INACTIVA',
      );
    });
  });

  describe('the batch', () => {
    /**
     * It lived in a module-scope `Map`. With more than one instance — which is every real
     * deployment — the preview landed on one pod and the confirm on another, which answered
     * "expired or already processed". Storing it means any instance can serve the confirm.
     */
    it('survives outside the process that previewed it', async () => {
      const result = await preview(balancedRows());

      const stored = await dataSource
        .getRepository(JournalEntryImportBatch)
        .findOneByOrFail({ id: result.batchId });
      expect(stored.organizationId).toBe(organizationId);
      expect(stored.createdByUserId).toBe(ACTOR);
      expect(stored.status).toBe(ImportBatchStatus.PENDING);
      expect(stored.entries).toHaveLength(1);
    });

    it('posts the entries and marks itself spent', async () => {
      const result = await preview(balancedRows());
      const outcome = await importer.confirm({ batchId: result.batchId }, organizationId, ACTOR);

      expect(outcome.createdEntriesCount).toBe(1);
      expect(
        (await dataSource.getRepository(JournalEntryImportBatch).findOneByOrFail({ id: result.batchId }))
          .status,
      ).toBe(ImportBatchStatus.CONFIRMED);
    });

    it('cannot be confirmed twice', async () => {
      const result = await preview(balancedRows());
      await importer.confirm({ batchId: result.batchId }, organizationId, ACTOR);

      await expect(
        importer.confirm({ batchId: result.batchId }, organizationId, ACTOR),
      ).rejects.toMatchObject({
        messageKey: 'JOURNAL_ENTRIES.LOTE_IMPORTACION_NO_ENCONTRADO_EXPIRADO_YA_PROCESADO',
      });
    });

    it('cannot be confirmed by another user', async () => {
      const result = await preview(balancedRows());

      await expect(
        importer.confirm({ batchId: result.batchId }, organizationId, OTHER_USER),
      ).rejects.toMatchObject({ messageKey: 'JOURNAL_ENTRIES.IMPORT.LOTE_DE_OTRO_USUARIO' });
    });

    it('cannot be confirmed by another tenant', async () => {
      const result = await preview(balancedRows());
      const other = await dataSource.getRepository(Organization).save(
        dataSource.getRepository(Organization).create({
          legalName: `Otro ${Date.now()}`,
          timezone: 'America/Santo_Domingo',
        }),
      );

      await expect(
        importer.confirm({ batchId: result.batchId }, other.id, ACTOR),
      ).rejects.toMatchObject({
        messageKey: 'JOURNAL_ENTRIES.LOTE_IMPORTACION_NO_ENCONTRADO_EXPIRADO_YA_PROCESADO',
      });

      await dataSource.getRepository(Organization).delete({ id: other.id });
    });

    it('refuses a batch whose window has passed', async () => {
      const result = await preview(balancedRows());
      await dataSource
        .getRepository(JournalEntryImportBatch)
        .update({ id: result.batchId }, { expiresAt: new Date(Date.now() - 1_000) });

      await expect(
        importer.confirm({ batchId: result.batchId }, organizationId, ACTOR),
      ).rejects.toMatchObject({
        messageKey: 'JOURNAL_ENTRIES.LOTE_IMPORTACION_NO_ENCONTRADO_EXPIRADO_YA_PROCESADO',
      });
    });

    /** Only the sound entries are carried forward; a bad one does not take the file with it. */
    it('carries the valid entries and leaves the invalid ones behind', async () => {
      const rows = [
        ...balancedRows(),
        { Asiento: 'A2', Fecha: '11/03/2026', Concepto: 'Descuadrado', Cuenta: '1101', Debe: '100,00', Haber: '', Detalle: '' },
        { Asiento: 'A2', Fecha: '11/03/2026', Concepto: 'Descuadrado', Cuenta: '4100', Debe: '', Haber: '99,00', Detalle: '' },
      ];

      const result = await preview(rows);
      expect(result.totalEntries).toBe(2);
      expect(result.validEntriesCount).toBe(1);
      expect(result.invalidEntriesCount).toBe(1);

      const stored = await dataSource
        .getRepository(JournalEntryImportBatch)
        .findOneByOrFail({ id: result.batchId });
      expect(stored.entries).toHaveLength(1);
      expect(stored.entries[0].description).toBe('Venta del día');
    });
  });

  describe('what reaches the ledger', () => {
    it('posts the amounts the file actually stated', async () => {
      const result = await preview(balancedRows());
      await importer.confirm({ batchId: result.batchId }, organizationId, ACTOR);

      const [totals] = await dataSource.query<{ debit: string; credit: string }[]>(
        `SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
           FROM "journal_entry_lines" l
           JOIN "journal_entries" e ON e.id = l.journal_entry_id
          WHERE e.organization_id = $1 AND e.description = 'Venta del día' AND e.date = '2026-03-10'`,
        [organizationId],
      );
      // 58,750.00 — not 58.75, which is what `parseFloat` made of `58.750,00`.
      expect(Number(totals.debit)).toBeGreaterThanOrEqual(58_750);
      expect(Number(totals.credit)).toBeGreaterThanOrEqual(58_750);
    });

    it('gives every line the default ledger’s valuation', async () => {
      const result = await preview(balancedRows());
      const stored = await dataSource
        .getRepository(JournalEntryImportBatch)
        .findOneByOrFail({ id: result.batchId });

      for (const line of stored.entries[0].lines) {
        expect(line.valuations).toEqual([
          { ledgerId, debit: line.debit, credit: line.credit },
        ]);
      }
    });
  });
});
