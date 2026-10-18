import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  DataTransferContext,
  DataTransferDataset,
  DataTransferFileProblem,
} from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { PERMISSIONS } from '../shared/permissions';
import { BadRequestError } from '../i18n/localized.exception';
import { roundAmount, toCents } from '../common/money';
import { SuppliersService } from '../suppliers/suppliers.service';
import { AccountsPayableService } from './accounts-payable.service';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';
import { VendorBillImportRowDto } from './dto/vendor-bill-import-row.dto';
import { VendorBill } from './entities/vendor-bill.entity';

/** What the tax id and NCF are compared on: no spaces, no dashes, upper case. */
const normalize = (value: string | undefined | null) => (value ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

/**
 * Supplier bills, one row each, for export and import.
 *
 * Importing is how the payables a company already owes arrive from its previous system (and how
 * a batch of paper bills is keyed in a spreadsheet). Each row becomes a one-line bill and goes
 * through `AccountsPayableService.create`, so it meets the form's rules — the supplier must exist
 * (found by tax id), the NCF must be well formed and not already recorded for that supplier, the
 * withholding follows from who the supplier is — and every bill lands as a DRAFT, to be reviewed
 * and approved like any other before it reaches the ledger.
 *
 * For bills dated before the company started using the product, the expense account to give is
 * the opening-balance equity account: the expense is already in the books it came from, and the
 * payable it leaves is what the opening trial balance did not carry (see the opening-balances
 * dataset, which refuses the payables control account for exactly that reason).
 */
@Injectable()
export class VendorBillsDataTransferProvider implements DataTransferDataset<VendorBillImportRowDto>, OnModuleInit {
  readonly id = 'vendor_bills';
  readonly labelKey = 'data_transfer.datasets.vendor_bills';
  readonly hintKey = 'data_transfer.hints.vendor_bills';
  readonly viewPermission = PERMISSIONS.ACCOUNTS_PAYABLE_VIEW;
  readonly columns = [
    { key: 'ncf', property: 'ncf', example: 'B0100000123' },
    { key: 'proveedor', property: 'vendorName' },
    { key: 'tax_id_proveedor', property: 'vendorTaxId', required: true, example: '131-12345-7' },
    { key: 'fecha', property: 'date', required: true, example: '2026-01-15' },
    { key: 'vencimiento', property: 'dueDate', required: true, example: '2026-02-14' },
    { key: 'moneda', property: 'currencyCode', example: 'DOP' },
    { key: 'concepto', property: 'description', required: true, example: 'Servicio de mantenimiento enero' },
    { key: 'cuenta_gasto', property: 'expenseAccountCode', required: true, example: '6105' },
    { key: 'subtotal', property: 'subtotal', required: true, example: '10000.00' },
    { key: 'impuesto', property: 'taxAmount', example: '1800.00' },
    { key: 'total', property: 'total', example: '11800.00' },
    { key: 'saldo', property: 'balance' },
    { key: 'estado', property: 'status' },
  ] as const;

  readonly import = {
    createPermission: PERMISSIONS.ACCOUNTS_PAYABLE_CREATE,
    dto: VendorBillImportRowDto,
    check: async (row: VendorBillImportRowDto, context: DataTransferContext) => {
      await this.service.assertImportable(await this.toBill(row, context.organizationId), context.organizationId);
    },
    checkFile: async (rows: readonly VendorBillImportRowDto[]) => this.duplicatesInFile(rows),
    create: async (row: VendorBillImportRowDto, context: DataTransferContext) => {
      await this.service.create(await this.toBill(row, context.organizationId), context.organizationId, context.userId);
    },
  };

  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly service: AccountsPayableService,
    private readonly suppliers: SuppliersService,
    private readonly dataSource: DataSource,
    @InjectRepository(VendorBill) private readonly bills: Repository<VendorBill>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this as DataTransferDataset);
  }

  async exportPage(organizationId: string, take: number, skip: number) {
    const [bills, total] = await this.bills.findAndCount({
      where: { organizationId },
      relations: { vendor: true, lines: true },
      order: { date: 'DESC', id: 'ASC' },
      take,
      skip,
    });
    const accountIds = [...new Set(bills.flatMap((bill) => bill.lines ?? []).map((line) => line.expenseAccountId).filter(Boolean))];
    const codes = new Map<string, string>(
      accountIds.length
        ? (
            await this.dataSource.query(`SELECT id, code FROM accounts WHERE organization_id = $1 AND id = ANY($2)`, [
              organizationId,
              accountIds,
            ])
          ).map((row: { id: string; code: string }) => [row.id, row.code])
        : [],
    );
    const rows = bills.map((bill) => {
      const lines = bill.lines ?? [];
      const firstAccount = lines.find((line) => line.expenseAccountId)?.expenseAccountId;
      return {
        ...bill,
        vendorName: bill.vendor?.name ?? null,
        vendorTaxId: bill.vendor?.taxId ?? null,
        description: lines.map((line) => line.product).filter(Boolean).join('; ') || null,
        expenseAccountCode: firstAccount ? (codes.get(firstAccount) ?? null) : null,
        subtotal: roundAmount(lines.reduce((sum, line) => sum + Number(line.total ?? 0), 0)),
      };
    });
    return { rows: rows as unknown as Array<Record<string, unknown>>, total };
  }

  /** The row as the bill the form would have sent. */
  private async toBill(row: VendorBillImportRowDto, organizationId: string): Promise<CreateVendorBillDto> {
    const taxAmount = row.taxAmount ?? 0;
    if (row.total !== undefined && toCents(row.total) !== toCents(row.subtotal) + toCents(taxAmount)) {
      throw new BadRequestError('data_transfer.vendor_bills.total_mismatch', {
        total: row.total,
        expected: roundAmount(row.subtotal + taxAmount),
      });
    }
    if (row.dueDate < row.date) throw new BadRequestError('data_transfer.vendor_bills.due_before_date');

    const supplier = await this.suppliers.findByTaxId(organizationId, row.vendorTaxId);
    if (!supplier) {
      throw new BadRequestError('data_transfer.vendor_bills.unknown_supplier', { taxId: row.vendorTaxId });
    }
    const [account] = await this.dataSource.query(
      `SELECT a.id, a."isPostable" AS "isPostable", a."isActive" AS "isActive", a.is_blocked_for_posting AS "blocked",
              (a.id = s.default_accounts_payable_id) AS "isPayables"
         FROM accounts a LEFT JOIN organization_settings s ON s.organization_id = a.organization_id
        WHERE a.organization_id = $1 AND a.code = $2`,
      [organizationId, row.expenseAccountCode],
    );
    if (!account) {
      throw new BadRequestError('data_transfer.vendor_bills.unknown_account', { code: row.expenseAccountCode });
    }
    if (!account.isPostable || !account.isActive || account.blocked || account.isPayables) {
      throw new BadRequestError('data_transfer.vendor_bills.account_not_usable', { code: row.expenseAccountCode });
    }

    return Object.assign(new CreateVendorBillDto(), {
      vendorId: supplier.id,
      ncf: row.ncf,
      date: row.date,
      dueDate: row.dueDate,
      currencyCode: row.currencyCode?.toUpperCase(),
      taxAmount,
      lines: [
        {
          product: row.description,
          quantity: 1,
          unitPrice: row.subtotal,
          total: row.subtotal,
          expenseAccountId: account.id as string,
        },
      ],
    });
  }

  /** The same supplier's same comprobante twice in one file: the second would be refused at commit. */
  private async duplicatesInFile(rows: readonly VendorBillImportRowDto[]): Promise<DataTransferFileProblem[]> {
    const seen = new Map<string, number>();
    const problems: DataTransferFileProblem[] = [];
    rows.forEach((row, index) => {
      const ncf = normalize(row.ncf);
      if (!ncf) return;
      const key = `${normalize(row.vendorTaxId)}:${ncf}`;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, index);
      else problems.push({ index, column: 'ncf', key: 'data_transfer.duplicate_in_file', params: { value: row.ncf, first: first + 2 } });
    });
    return problems;
  }
}
