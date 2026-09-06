import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExchangeRateResolver } from '../../currencies/exchange-rate-resolver.service';
import { Organization } from '../../organizations/entities/organization.entity';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { Journal } from '../../journal-entries/entities/journal.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import {
  AccountCategory,
  AccountNature,
  AccountRole,
  AccountType,
} from '../../chart-of-accounts/enums/account-enums';
import {
  AccountingPeriod,
  PeriodStatus,
} from '../../accounting/entities/accounting-period.entity';
import { JournalEntry } from '../../journal-entries/entities/journal-entry.entity';
import { JournalEntryAttachment } from '../../journal-entries/entities/journal-entry-attachment.entity';
import { JournalEntriesService } from '../../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../../journal-entries/journal-entry-numbering.service';
import { AuditTrailService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AccountBalancesService } from '../../chart-of-accounts/account-balances.service';
import { CreateJournalEntryDto } from '../../journal-entries/dto/create-journal-entry.dto';
import { MexicanElectronicAccounting } from './mx-electronic-accounting';

/**
 * Mexico's electronic accounting: the three files of Anexo 24.
 *
 * The audit's finding was that the hard part was done and the easy part was not — `NumUnIdenPol`,
 * the gap-free consecutive per journal per fiscal year that normally forces a ledger rewrite, was
 * already produced, and nothing serialised any of it. These assert the serialisation against a
 * real ledger, because the figures have to be the ones the balance sheet reads: a filing that
 * disagrees with the statements it came from is the defect worth catching.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('Mexican electronic accounting', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let entries: JournalEntriesService;
  let accounting: MexicanElectronicAccounting;

  let organizationId: string;
  let generalJournalId: string;
  const account: Record<string, string> = {};

  const ACTOR = '66666666-6666-4666-8666-666666666666';
  const RFC = 'AAA010101AAA';

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
      entities: [`${__dirname}/../../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();

    const balances = new AccountBalancesService(dataSource);
    accounting = new MexicanElectronicAccounting(dataSource.manager, balances);
    entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null) } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      new AuditTrailService(dataSource.getRepository(AuditLog)),
      new ExchangeRateResolver(dataSource),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `SAT ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Mexico_City',
        country: 'MX',
        taxId: RFC,
      }),
    );
    organizationId = org.id;

    await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({
        organizationId,
        name: 'Principal',
        currency: 'MXN',
        isDefault: true,
        isActive: true,
      }),
    );

    const journal = await dataSource.getRepository(Journal).save({
      organizationId,
      code: 'DIARIO',
      name: 'Diario general',
      type: 'GENERAL' as const,
    });
    generalJournalId = journal.id;

    const make = async (
      key: string,
      code: string,
      name: string,
      type: AccountType,
      category: AccountCategory,
      nature: AccountNature,
      fiscalGroupingCode: string | null,
      systemRole: AccountRole | null = null,
    ) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code,
          name: { es: name },
          type,
          category,
          nature,
          systemRole,
          fiscalGroupingCode,
          isPostable: true,
          isActive: true,
        }),
      );
      account[key] = saved.id;
    };

    await make('bankParent', '102', 'Bancos', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, '102');
    await make('bank', '102.01', 'Bancos nacionales', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, '102.01', AccountRole.BANK);
    await make('payable', '201.01', 'Proveedores nacionales', AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, AccountNature.CREDIT, '201.01', AccountRole.ACCOUNTS_PAYABLE);
    await make('revenue', '401.01', 'Ventas y/o servicios gravados', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, AccountNature.CREDIT, '401.01', AccountRole.SALES_REVENUE);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({ organizationId, baseCurrency: 'MXN' }),
    );

    await dataSource.getRepository(AccountingPeriod).save([
      { organizationId, name: 'Mayo 2026', startDate: '2026-05-01' as unknown as Date, endDate: '2026-05-31' as unknown as Date, status: PeriodStatus.OPEN },
      { organizationId, name: 'Junio 2026', startDate: '2026-06-01' as unknown as Date, endDate: '2026-06-30' as unknown as Date, status: PeriodStatus.OPEN },
    ]);
  });

  afterEach(async () => {
    await dataSource.getRepository(Organization).delete({ id: organizationId });
  });

  const post = (
    date: string,
    description: string,
    lines: { accountId: string; debit?: number; credit?: number; description?: string }[],
  ) =>
    entries.create(
      {
        date,
        description,
        journalId: generalJournalId,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
          description: line.description,
        })),
      } as CreateJournalEntryDto,
      organizationId,
      { actorUserId: ACTOR },
    );

  /** The month under test. `organizationId` is spread in at each call: it changes per test. */
  const period = { year: 2026, month: 6 };

  describe('Catálogo de cuentas', () => {
    it('maps every account onto its SAT grouping code, with its level and nature', async () => {
      const xml = await accounting.catalogo({ organizationId, ...period });

      expect(xml).toContain('catalogocuentas:Catalogo');
      expect(xml).toContain('Version="1.3"');
      expect(xml).toContain(`RFC="${RFC}"`);
      expect(xml).toContain('Mes="06"');
      expect(xml).toContain('Anio="2026"');

      // A bank account: grouping code 102.01, level 2, debit nature, child of 102.
      expect(xml).toContain('CodAgrup="102.01"');
      expect(xml).toContain('NumCta="102.01"');
      expect(xml).toContain('Desc="Bancos nacionales"');
      expect(xml).toContain('Nivel="2"');
      expect(xml).toContain('SubCtaDe="102"');
      expect(xml).toMatch(/NumCta="102\.01"[^>]*Natur="D"/);
      // A liability increases on the credit side.
      expect(xml).toMatch(/NumCta="201\.01"[^>]*Natur="A"/);
    });

    it('refuses to build a catalogue with an unmapped account rather than filing a blank code', async () => {
      await dataSource
        .getRepository(Account)
        .update({ id: account['revenue'] }, { fiscalGroupingCode: null });

      // The SAT rejects the upload; discovering that at the Buzón Tributario on the deadline is a
      // worse way to learn it. The message names how many and gives one example.
      await expect(accounting.catalogo({ organizationId, ...period })).rejects.toMatchObject({
        messageKey: 'COMPLIANCE.CUENTAS_SIN_CODIGO_AGRUPADOR_SAT',
      });
    });

    it('refuses to build anything for a taxpayer with no RFC', async () => {
      await dataSource.getRepository(Organization).update({ id: organizationId }, { taxId: null });

      await expect(accounting.catalogo({ organizationId, ...period })).rejects.toMatchObject({
        messageKey: 'COMPLIANCE.ORGANIZACION_SIN_RFC',
      });
    });
  });

  describe('Balanza de comprobación', () => {
    it('states the opening balance, the month and the closing balance in each account', async () => {
      await post('2026-05-20', 'Venta de mayo', [
        { accountId: account['bank'], debit: 10_000 },
        { accountId: account['revenue'], credit: 10_000 },
      ]);
      await post('2026-06-10', 'Venta de junio', [
        { accountId: account['bank'], debit: 4_000 },
        { accountId: account['revenue'], credit: 4_000 },
      ]);
      await post('2026-06-20', 'Pago a proveedor', [
        { accountId: account['payable'], debit: 1_500 },
        { accountId: account['bank'], credit: 1_500 },
      ]);

      const xml = await accounting.balanza({ organizationId, ...period });

      expect(xml).toContain('BCE:Balanza');
      expect(xml).toContain('TipoEnvio="N"');
      // The bank: opened June at 10,000, took 4,000 in and 1,500 out, closed at 12,500.
      expect(xml).toMatch(
        /NumCta="102\.01"\s+SaldoIni="10000\.00"\s+Debe="4000\.00"\s+Haber="1500\.00"\s+SaldoFin="12500\.00"/,
      );
      // Revenue in the SAT's own sense: a credit balance is stated positive, not as −14,000.
      expect(xml).toMatch(
        /NumCta="401\.01"\s+SaldoIni="10000\.00"\s+Debe="0\.00"\s+Haber="4000\.00"\s+SaldoFin="14000\.00"/,
      );
    });

    it('leaves out an account that neither carried a balance nor moved', async () => {
      await post('2026-06-10', 'Venta de junio', [
        { accountId: account['bank'], debit: 4_000 },
        { accountId: account['revenue'], credit: 4_000 },
      ]);

      const xml = await accounting.balanza({ organizationId, ...period });

      // Filing every account in the chart with four zeroes is a larger file that says less.
      expect(xml).not.toContain('NumCta="201.01"');
      expect(xml).toContain('NumCta="102.01"');
    });

    it('carries the correction date only on a complementary filing', async () => {
      await post('2026-06-10', 'Venta', [
        { accountId: account['bank'], debit: 1_000 },
        { accountId: account['revenue'], credit: 1_000 },
      ]);

      const ordinary = await accounting.balanza(
        { organizationId, ...period },
        { fechaModBal: '2026-07-15' },
      );
      const complementary = await accounting.balanza(
        { organizationId, ...period },
        { tipoEnvio: 'C', fechaModBal: '2026-07-15' },
      );

      // The SAT rejects `FechaModBal` on an ordinary filing, which is why it is not simply always
      // written.
      expect(ordinary).not.toContain('FechaModBal');
      expect(complementary).toContain('TipoEnvio="C"');
      expect(complementary).toContain('FechaModBal="2026-07-15"');
    });
  });

  describe('Pólizas del periodo', () => {
    it("uses the ledger's own consecutive as NumUnIdenPol and lists every line", async () => {
      await post('2026-06-10', 'Venta de contado', [
        { accountId: account['bank'], debit: 4_000, description: 'Depósito' },
        { accountId: account['revenue'], credit: 4_000, description: 'Ingreso' },
      ]);

      const xml = await accounting.polizas({ organizationId, ...period });

      expect(xml).toContain('PLZ:Polizas');
      expect(xml).toContain('TipoSolicitud="AF"');
      // Gap-free, per journal, per fiscal year — allocated inside the posting transaction. This is
      // the requirement that normally forces a ledger rewrite, and it was already satisfied.
      expect(xml).toContain('NumUnIdenPol="DIARIO-2026-000001"');
      expect(xml).toContain('Fecha="2026-06-10"');
      expect(xml).toContain('Concepto="Venta de contado"');
      expect(xml).toMatch(/NumCta="102\.01"[^>]*Debe="4000\.00" Haber="0\.00"/);
      expect(xml).toMatch(/NumCta="401\.01"[^>]*Debe="0\.00" Haber="4000\.00"/);
      expect(xml).toContain('DesCta="Bancos nacionales"');
    });

    it('leaves out an entry from another month', async () => {
      await post('2026-05-20', 'Venta de mayo', [
        { accountId: account['bank'], debit: 1_000 },
        { accountId: account['revenue'], credit: 1_000 },
      ]);
      await post('2026-06-10', 'Venta de junio', [
        { accountId: account['bank'], debit: 2_000 },
        { accountId: account['revenue'], credit: 2_000 },
      ]);

      const xml = await accounting.polizas({ organizationId, ...period });

      expect(xml).toContain('Concepto="Venta de junio"');
      expect(xml).not.toContain('Concepto="Venta de mayo"');
    });

    it('writes the order number only for the procedures that carry one', async () => {
      await post('2026-06-10', 'Venta', [
        { accountId: account['bank'], debit: 1_000 },
        { accountId: account['revenue'], credit: 1_000 },
      ]);

      // `NumOrden` belongs to an audit or a certification; `NumTramite` to a refund or an offset.
      // Writing the wrong one, or both, is a rejected upload.
      const audit = await accounting.polizas(
        { organizationId, ...period },
        { tipoSolicitud: 'AF', numOrden: 'ABC1234567/26', numTramite: 'IGNORADO' },
      );
      expect(audit).toContain('NumOrden="ABC1234567/26"');
      expect(audit).not.toContain('NumTramite');

      const refund = await accounting.polizas(
        { organizationId, ...period },
        { tipoSolicitud: 'DE', numTramite: 'TR-2026-9', numOrden: 'IGNORADO' },
      );
      expect(refund).toContain('NumTramite="TR-2026-9"');
      expect(refund).not.toContain('NumOrden');
    });
  });
});
