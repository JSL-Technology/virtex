import { DataSource } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { Journal } from '../../journal-entries/entities/journal.entity';
import { TenantBookkeepingProvisioner } from './tenant-bookkeeping.provisioner';
import { I18nService } from '../../i18n/i18n.service';

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

  const provision = async (booksLanguage: 'es' | 'en' | 'pt') => {
    const organization = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `PROV ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
        booksLanguage,
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
    return { organizationId: organization.id, ledger, journals };
  };

  const nameOf = (journals: Journal[], code: string) =>
    journals.find((journal) => journal.code === code)?.name;

  it('names the ledger and the journals in the language the books are kept in', async () => {
    const english = await provision('en');

    expect(english.ledger?.name).toBe('Main Ledger');
    expect(nameOf(english.journals, 'VENTAS')).toBe('Sales Journal');
    expect(nameOf(english.journals, 'COMPRAS')).toBe('Purchases Journal');
    expect(nameOf(english.journals, 'NOMINA')).toBe('Payroll Journal');
  });

  it('keeps the codes the posting services look up unchanged', async () => {
    const english = await provision('en');

    // The identifiers, not the labels. Translating these would break every posting path.
    expect(english.journals.map((journal) => journal.code).sort()).toEqual([
      'BANCOS',
      'CAJA',
      'COBROS',
      'COMPRAS',
      'GENERAL',
      'NOMINA',
      'PAGOS',
      'VENTAS',
    ]);
  });

  it('still provisions Spanish books in Spanish', async () => {
    const spanish = await provision('es');

    expect(spanish.ledger?.name).toBe('Libro Principal');
    expect(nameOf(spanish.journals, 'VENTAS')).toBe('Diario de Ventas');
  });

  it('provisions Portuguese books in Portuguese', async () => {
    const portuguese = await provision('pt');

    expect(portuguese.ledger?.name).toBe('Livro Principal');
    expect(nameOf(portuguese.journals, 'COBROS')).toBe('Diário de Cobranças');
  });
});
