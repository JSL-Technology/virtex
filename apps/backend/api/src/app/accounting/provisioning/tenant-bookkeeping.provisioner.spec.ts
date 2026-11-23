import { DataSource } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Ledger } from '../entities/ledger.entity';
import { Journal } from '../../journal-entries/entities/journal.entity';
import { TenantBookkeepingProvisioner } from './tenant-bookkeeping.provisioner';
import { I18nService } from '../../i18n/i18n.service';
import { FiscalYear } from '../entities/fiscal-year.entity';
import { AccountingPeriod } from '../entities/accounting-period.entity';
import { SYSTEM_JOURNALS } from '../../contracts/ledger-posting/system-journals';

/**
 * What a tenant's own books are named in.
 *
 * Every tenant the product has ever created was given a ledger called `Libro Principal` and eight
 * journals called `Diario de Ventas`, `Diario de Compras` and so on — in Spanish, whatever
 * language the organisation keeps its books in. A company in Denver invoicing in English opened
 * the journal picker on its very first invoice and had to choose between eight Spanish words.
 *
 * The *code* is a different matter and stays Spanish: `VENTAS` is what `InvoicePostingService`
 * looks up, the way a column name is looked up, and translating it would break every posting path
 * in the product. The name is the part a person reads, and it is the part that follows the books.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('tenant bookkeeping provisioning', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let provisioner: TenantBookkeepingProvisioner;

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
    provisioner = new TenantBookkeepingProvisioner(new I18nService());
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  const provision = async (booksLanguage: 'es' | 'en' | 'pt', country: string | null = null) => {
    const organization = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `PROV ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
        booksLanguage,
        country,
      }),
    );
    await dataSource.transaction((manager) =>
      provisioner.provision(organization, 'DOP', manager),
    );
    const [ledger, journals] = await Promise.all([
      dataSource
        .getRepository(Ledger)
        .findOneBy({ organizationId: organization.id, isDefault: true }),
      dataSource.getRepository(Journal).findBy({ organizationId: organization.id }),
    ]);
    return { organization, organizationId: organization.id, ledger, journals };
  };

  const nameOf = (journals: Journal[], code: string) =>
    journals.find((journal) => journal.code === code)?.name;

  it('names the ledger and the journals in the language the books are kept in', async () => {
    const english = await provision('en');

    expect(english.ledger?.name).toBe('Main ledger');
    expect(nameOf(english.journals, 'VENTAS')).toBe('Sales journal');
    expect(nameOf(english.journals, 'COMPRAS')).toBe('Purchases journal');
    expect(nameOf(english.journals, 'NOMINA')).toBe('Payroll journal');
  });

  it('keeps the codes the posting services look up unchanged', async () => {
    const english = await provision('en');

    // The identifiers, not the labels. Translating these would break every posting path.
    expect(english.journals.map((journal) => journal.code).sort()).toEqual([
      // Fixed-asset disposals (FINB-10) and the inflation adjustment: looked up by every disposal
      // and every adjustment, and provisioned by nobody until they joined the catalogue.
      'ACT-FIJOS',
      'AJU-INF',
      'BANCOS',
      'CAJA',
      // Period close (QA C-06): depreciation, closing and reconciliation post into journals of
      // their own, so each is provisioned with the tenant instead of failing on first use.
      'CIERRE',
      'COBROS',
      'COMPRAS',
      'CONCIL',
      'DEPREC',
      'GENERAL',
      'NOMINA',
      'PAGOS',
      'VENTAS',
    ]);
  });

  it('provisions exactly the journals the services are typed to look up', async () => {
    const english = await provision('en');

    // `SYSTEM_JOURNALS` is what `journalCode` and `JournalLookupService` accept: a code outside it
    // does not compile, and every code in it exists on a new company.
    expect(english.journals.map((journal) => journal.code).sort()).toEqual(
      Object.values(SYSTEM_JOURNALS).map((journal) => journal.code).sort(),
    );
    expect(nameOf(english.journals, 'ACT-FIJOS')).toBe('Fixed assets journal');
  });

  it('still provisions Spanish books in Spanish', async () => {
    const spanish = await provision('es');

    expect(spanish.ledger?.name).toBe('Libro principal');
    expect(nameOf(spanish.journals, 'VENTAS')).toBe('Diario de ventas');
  });

  it('provisions Portuguese books in Portuguese', async () => {
    const portuguese = await provision('pt');

    expect(portuguese.ledger?.name).toBe('Livro principal');
    expect(nameOf(portuguese.journals, 'COBROS')).toBe('Diário de cobranças');
  });
  /**
   * The periods came alone: twelve months and no fiscal year, so the year-end close had nothing
   * to close for any tenant (QA M-09).
   */
  it('opens the calendar year as a fiscal year together with its twelve periods', async () => {
    const { organizationId } = await provision('es');
    const year = new Date().getUTCFullYear();
    const years = await dataSource.getRepository(FiscalYear).findBy({ organizationId });
    expect(years.map((y) => [String(y.startDate).slice(0, 10), String(y.endDate).slice(0, 10)])).toEqual([
      [`${year}-01-01`, `${year}-12-31`],
    ]);
    expect(await dataSource.getRepository(AccountingPeriod).countBy({ organizationId })).toBe(12);
  });

  /** The working defaults a company starts with (task: initial seeding). */
  const countOf = async (sql: string, organizationId: string) =>
    Number((await dataSource.query(sql, [organizationId]))[0].count);

  it('starts a company with its tax authority\'s depreciation categories, in its books language and translated — once', async () => {
    const categoriesOf = (organizationId: string) =>
      dataSource.query(
        `SELECT "code", "name", "name_translations" AS "translations", "tax_category_code" AS "taxCode",
                "tax_method" AS "method", "tax_annual_rate"::float AS "rate"
           FROM "fixed_asset_categories" WHERE "organization_id" = $1 ORDER BY "code"`,
        [organizationId],
      );
    const dominican = await provision('es', 'DO');
    const seeded = await categoriesOf(dominican.organizationId);
    expect(seeded.map((row: { code: string; method: string; rate: number }) => [row.code, row.method, row.rate])).toEqual([
      ['DO-1', 'DECLINING_BALANCE', 0.05],
      ['DO-2', 'DECLINING_BALANCE', 0.25],
      ['DO-3', 'DECLINING_BALANCE', 0.15],
    ]);
    expect(seeded[1]).toMatchObject({
      taxCode: 'DO-2',
      name: expect.stringMatching(/^Categoría 2 — /),
      translations: { en: expect.stringMatching(/^Category 2 — /), pt: expect.stringMatching(/^Categoria 2 — /) },
    });
    // Re-provisioning adds none, and keeps a name the company gave one.
    await dataSource.query(`UPDATE "fixed_asset_categories" SET "name" = 'Vehículos y equipo' WHERE "organization_id" = $1 AND "code" = 'DO-2'`, [dominican.organizationId]);
    await dataSource.transaction((manager) => provisioner.provision(dominican.organization, 'DOP', manager));
    const again = await categoriesOf(dominican.organizationId);
    expect(again).toHaveLength(3);
    expect(again[1].name).toBe('Vehículos y equipo');

    const mexican = await provision('es', 'MX');
    expect((await categoriesOf(mexican.organizationId)).map((row: { code: string; method: string }) => [row.code, row.method])).toEqual([
      ['MX-34-I', 'STRAIGHT_LINE'],
      ['MX-34-III', 'STRAIGHT_LINE'],
      ['MX-34-VI', 'STRAIGHT_LINE'],
      ['MX-34-VII', 'STRAIGHT_LINE'],
      ['MX-34-VIII', 'STRAIGHT_LINE'],
    ]);
    // A market whose law the product carries no categories for starts with none.
    const american = await provision('en', 'US');
    expect(await categoriesOf(american.organizationId)).toEqual([]);
  });

  it('seeds a final consumer, a category and the Dominican payroll concepts — once', async () => {
    const { organization, organizationId } = await provision('es', 'DO');

    const consumers = await dataSource.query(
      `SELECT "companyName", "status" FROM "customers" WHERE "organization_id" = $1 AND "is_final_consumer"`,
      [organizationId],
    );
    expect(consumers).toEqual([{ companyName: 'Consumidor final', status: 'ACTIVE' }]);
    expect(await countOf(`SELECT count(*) FROM "product_categories" WHERE "organization_id" = $1`, organizationId)).toBe(1);

    const concepts = await dataSource.query(
      `SELECT "code", "is_system" FROM "payroll_concepts" WHERE "organization_id" = $1 ORDER BY "sort_order"`,
      [organizationId],
    );
    expect(concepts.map((c: { code: string }) => c.code)).toEqual(
      ['HE35', 'HE100', 'NOCT', 'BONO', 'COMISION', 'AFP', 'SFS', 'ISR', 'PRESTAMO', 'ANTICIPO'],
    );
    expect(concepts.filter((c: { is_system: boolean }) => c.is_system).map((c: { code: string }) => c.code)).toEqual(['AFP', 'SFS', 'ISR']);

    // Re-provisioning (Settings › Reprovision, a retried signup) adds nothing.
    await dataSource.transaction((manager) => provisioner.provision(organization, 'DOP', manager));
    expect(await countOf(`SELECT count(*) FROM "customers" WHERE "organization_id" = $1`, organizationId)).toBe(1);
    expect(await countOf(`SELECT count(*) FROM "payroll_concepts" WHERE "organization_id" = $1`, organizationId)).toBe(10);
  });

  it('adopts a «Consumidor final» the company already created instead of adding a second', async () => {
    const organization = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `PROV ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
        booksLanguage: 'es',
        country: 'DO',
      }),
    );
    await dataSource.query(
      `INSERT INTO "customers" ("organization_id", "companyName", "status") VALUES ($1, 'consumidor final', 'ACTIVE')`,
      [organization.id],
    );
    await dataSource.transaction((manager) => provisioner.provision(organization, 'DOP', manager));
    const rows = await dataSource.query(
      `SELECT "is_final_consumer" FROM "customers" WHERE "organization_id" = $1`,
      [organization.id],
    );
    expect(rows).toEqual([{ is_final_consumer: true }]);
  });

  it('writes the seeded names in the language of the books, and the market’s own payroll concepts', async () => {
    const { organizationId } = await provision('en', 'US');
    const [consumer] = await dataSource.query(
      `SELECT "companyName" FROM "customers" WHERE "organization_id" = $1 AND "is_final_consumer"`,
      [organizationId],
    );
    // The United States pack names the counter sale's customer as Americans do (`country-pack.ts`).
    expect(consumer.companyName).toBe('Walk-in customer');
    // The United States pack carries its own payroll (federal and state withholding, FICA); none of
    // the Dominican TSS concepts may leak into it.
    const concepts: { code: string }[] = await dataSource.query(`SELECT "code" FROM "payroll_concepts" WHERE "organization_id" = $1`, [organizationId]);
    const codes = concepts.map((row) => row.code);
    expect(codes).toEqual(expect.arrayContaining(['SS', 'MEDICARE', 'FIT']));
    expect(codes).not.toEqual(expect.arrayContaining(['AFP']));
    expect(codes).not.toEqual(expect.arrayContaining(['SFS']));
  });
});
