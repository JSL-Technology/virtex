import { DataSource } from 'typeorm';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../common/database/testing/integration-db';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { DataTransferContext } from '../contracts/data-transfer/data-transfer.contract';
import { ConflictError } from '../i18n/localized.exception';
import { SuppliersService } from '../suppliers/suppliers.service';
import { AccountsPayableService } from './accounts-payable.service';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';
import { VendorBillImportRowDto } from './dto/vendor-bill-import-row.dto';
import { VendorBill } from './entities/vendor-bill.entity';
import { VendorBillsDataTransferProvider } from './vendor-bills-data-transfer.provider';

/**
 * Supplier bills from a file: each row becomes the one-line bill the form would have sent, and is
 * held to the same service — so the rules on the supplier, the NCF and the account are the form's.
 */
describeWithDb('vendor bills import', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let organizationId: string;
  let provider: VendorBillsDataTransferProvider;
  let context: DataTransferContext;
  let expenseId: string;
  const created: Array<{ dto: CreateVendorBillDto; actor: string | null }> = [];
  const recorded = new Set(['B0100000999']);

  const actor = '33333333-3333-4333-8333-333333333333';
  /** `tax_id_proveedor,ncf,fecha,vencimiento,concepto,cuenta_gasto,subtotal,impuesto,total`. */
  const rows = (...lines: string[]): VendorBillImportRowDto[] =>
    lines.map((line) => {
      const [vendorTaxId, ncf, date, dueDate, description, expenseAccountCode, subtotal, taxAmount, total] = line.split(',');
      return Object.assign(new VendorBillImportRowDto(), {
        vendorTaxId,
        ncf,
        date,
        dueDate,
        description,
        expenseAccountCode,
        subtotal: Number(subtotal),
        ...(taxAmount ? { taxAmount: Number(taxAmount) } : {}),
        ...(total ? { total: Number(total) } : {}),
      });
    });
  const refusalOf = (row: VendorBillImportRowDto) =>
    provider.import.check(row, context).then(() => null, (error) => error.messageKey as string);

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'CxP import');
    const account = async (code: string) => {
      const [row] = await dataSource.query(
        `INSERT INTO accounts (organization_id, code, name, type, category, nature, version, "isPostable")
         VALUES ($1, $2, '{"es":"Cuenta"}', 'EXPENSE', 'OPERATING_EXPENSE', 'DEBIT', 1, true) RETURNING id`,
        [organizationId, code],
      );
      return row.id as string;
    };
    expenseId = await account('6105');
    const payables = await account('2101');
    await dataSource.query(
      `INSERT INTO organization_settings (organization_id, base_currency, default_accounts_payable_id) VALUES ($1, 'DOP', $2)`,
      [organizationId, payables],
    );

    // The service's own suite covers what it enforces; here it stands in, with one of its refusals.
    const payablesService = {
      assertImportable: async (dto: CreateVendorBillDto) => {
        if (dto.ncf && recorded.has(dto.ncf)) throw new ConflictError('accounts_payable.ncf_already_recorded', { ncf: dto.ncf });
      },
      create: async (dto: CreateVendorBillDto, _org: string, actor: string | null) => {
        created.push({ dto, actor });
      },
    } as unknown as AccountsPayableService;
    const suppliers = {
      findByTaxId: async (_org: string, taxId: string) =>
        taxId.replace(/\D/g, '') === '131123457' ? { id: '44444444-4444-4444-8444-444444444444' } : null,
    } as unknown as SuppliersService;

    provider = new VendorBillsDataTransferProvider(
      new DataTransferRegistry(),
      payablesService,
      suppliers,
      dataSource,
      dataSource.getRepository(VendorBill),
    );
    context = { organizationId, userId: actor };
  });

  beforeEach(() => {
    created.length = 0;
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  it('creates each row as the one-line bill the form would send, by the person who imported it', async () => {
    const [row] = rows('131-12345-7,B0100000123,2026-01-15,2026-02-14,Mantenimiento enero,6105,10000,1800,11800');
    expect(await refusalOf(row)).toBeNull();

    await provider.import.create(row, context);

    expect(created).toEqual([
      {
        actor,
        dto: expect.objectContaining({
          vendorId: '44444444-4444-4444-8444-444444444444',
          ncf: 'B0100000123',
          date: '2026-01-15',
          dueDate: '2026-02-14',
          taxAmount: 1800,
          lines: [{ product: 'Mantenimiento enero', quantity: 1, unitPrice: 10000, total: 10000, expenseAccountId: expenseId }],
        }),
      },
    ]);
  });

  it('names each row that cannot be a bill, and why', async () => {
    const refusals = await Promise.all(
      rows(
        '000-00000-0,B0100000201,2026-01-15,2026-02-14,Sin proveedor,6105,100,,',
        '131-12345-7,B0100000202,2026-01-15,2026-02-14,Total mal,6105,100,18,120',
        '131-12345-7,B0100000203,2026-01-15,2026-02-14,Cuenta por pagar,2101,100,,',
        '131-12345-7,B0100000999,2026-01-15,2026-02-14,Ya registrada,6105,100,,',
        '131-12345-7,B0100000204,2026-02-15,2026-01-14,Vence antes,6105,100,,',
        '131-12345-7,B0100000205,2026-01-15,2026-02-14,Correcta,6105,100,,',
      ).map(refusalOf),
    );

    expect(refusals).toEqual([
      'data_transfer.vendor_bills.unknown_supplier',
      'data_transfer.vendor_bills.total_mismatch',
      'data_transfer.vendor_bills.account_not_usable',
      'accounts_payable.ncf_already_recorded',
      'data_transfer.vendor_bills.due_before_date',
      null,
    ]);
    expect(created).toEqual([]);
  });

  it('refuses the same supplier\'s same comprobante twice in one file, however it is written', async () => {
    const problems = await provider.import.checkFile(
      rows(
        '131-12345-7,B0100000301,2026-01-15,2026-02-14,Primera,6105,100,,',
        '131 12345 7,b01-00000301,2026-01-15,2026-02-14,Repetida,6105,100,,',
        '131-12345-7,B0100000302,2026-01-15,2026-02-14,Otra,6105,100,,',
      ),
    );

    expect(problems).toEqual([
      { index: 1, column: 'ncf', key: 'data_transfer.duplicate_in_file', params: { value: 'b01-00000301', first: 2 } },
    ]);
  });
});
