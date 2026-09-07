import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Product } from '../../inventory/entities/product.entity';
import { Invoice, InvoiceStatus } from '../../invoices/entities/invoice.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { VendorBill } from '../../accounts-payable/entities/vendor-bill.entity';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS } from '../../shared/permissions';
import { BadRequestError, ForbiddenError } from '../../i18n/localized.exception';
import { Page, resolvePaging, toPage } from '../../common/pagination';

/** One importable dataset: what it reads, what a caller must hold to read it, and its columns. */
interface DatasetDefinition {
  module: string;
  set: string;
  permission: string;
  /** Column keys the caller may request, and the entity property each maps to. */
  columns: Record<string, string>;
  load: (organizationId: string, take: number, skip: number) => Promise<[unknown[], number]>;
}

/**
 * Pulling a block of the tenant's own records into a sheet.
 *
 * ## What was wrong
 *
 * Two things, and the second is the serious one.
 *
 * `importData` switched on `module:set` and handled two cases. Everything else — every set the
 * `getAvailableModules` list offered and this service had not implemented: `inventory:movements`,
 * `sales:quotes`, `customers:list` — fell into a `default` branch that returned
 * `[{ name: 'Item 1', reference: 'REF001', price: 100, stock: 10 }, …]`. Invented rows, presented
 * to the user as their own data, inside a spreadsheet they would then compute with. A menu offering
 * six datasets of which two were real and four were fabrications is worse than a menu offering two.
 *
 * And it carried no permission at all. `POST /datasheets/import/data` was `JwtAuthGuard` only, so
 * any authenticated member could pull the full invoice register or the product catalogue with its
 * costs.
 *
 * ## What it does now
 *
 * A dataset exists in the catalogue only if it is implemented, it is gated by the same permission
 * that guards the module it reads, it is scoped to the caller's tenant, and it is paged — the old
 * one loaded every invoice the tenant had ever issued into memory to render a page of a sheet.
 * An unknown dataset is an error naming what is available, not a silent handful of fake rows.
 */
@Injectable()
export class DatasheetImportService {
  private readonly datasets: DatasetDefinition[];

  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(VendorBill) private readonly bills: Repository<VendorBill>,
  ) {
    this.datasets = [
      {
        module: 'inventory',
        set: 'products',
        permission: PERMISSIONS.PRODUCTS_VIEW,
        columns: {
          sku: 'sku',
          nombre: 'name',
          descripcion: 'description',
          precio: 'price',
          costo: 'cost',
          existencia: 'stock',
          estado: 'status',
        },
        load: (organizationId, take, skip) =>
          this.products.findAndCount({
            where: { organizationId },
            order: { name: 'ASC' },
            take,
            skip,
          }),
      },
      {
        module: 'sales',
        set: 'invoices',
        permission: PERMISSIONS.INVOICES_VIEW,
        columns: {
          numero: 'invoiceNumber',
          ncf: 'ncfNumber',
          fecha: 'issueDate',
          vencimiento: 'dueDate',
          cliente: 'customerName',
          moneda: 'currencyCode',
          subtotal: 'subtotal',
          impuesto: 'tax',
          total: 'total',
          saldo: 'balance',
          estado: 'status',
        },
        load: (organizationId, take, skip) =>
          this.invoices.findAndCount({
            where: { organizationId, status: In(ISSUED_INVOICE_STATUSES) },
            order: { issueDate: 'DESC', invoiceNumber: 'DESC' },
            take,
            skip,
          }),
      },
      {
        module: 'customers',
        set: 'list',
        permission: PERMISSIONS.CUSTOMERS_VIEW,
        columns: {
          nombre: 'companyName',
          rnc: 'taxId',
          correo: 'email',
          telefono: 'phone',
          direccion: 'address',
        },
        load: (organizationId, take, skip) =>
          this.customers.findAndCount({
            where: { organizationId },
            order: { companyName: 'ASC' },
            take,
            skip,
          }),
      },
      {
        module: 'purchases',
        set: 'bills',
        permission: PERMISSIONS.ACCOUNTS_PAYABLE_VIEW,
        columns: {
          ncf: 'ncf',
          fecha: 'date',
          vencimiento: 'dueDate',
          moneda: 'currencyCode',
          total: 'total',
          saldo: 'balance',
          estado: 'status',
        },
        load: (organizationId, take, skip) =>
          this.bills.findAndCount({
            where: { organizationId },
            order: { date: 'DESC' },
            take,
            skip,
          }),
      },
    ];
  }

  /**
   * The datasets this caller can actually import.
   *
   * Filtered by permission, so the menu does not offer what the request would then refuse — and
   * every entry is implemented, which is what the previous list could not claim.
   */
  getAvailableModules(user: AuthenticatedUser): {
    id: string;
    set: string;
    columns: string[];
  }[] {
    return this.datasets
      .filter((dataset) => this.holds(user, dataset.permission))
      .map((dataset) => ({
        id: dataset.module,
        set: dataset.set,
        columns: Object.keys(dataset.columns),
      }));
  }

  async importData(
    module: string,
    set: string,
    columns: string[],
    user: AuthenticatedUser,
    paging: { page?: number; pageSize?: number } = {},
  ): Promise<Page<Record<string, unknown>>> {
    const dataset = this.datasets.find(
      (candidate) => candidate.module === module && candidate.set === set,
    );
    if (!dataset) {
      throw new BadRequestError('DATASHEETS.CONJUNTO_DATOS_NO_DISPONIBLE', {
        requested: `${module}:${set}`,
        available: this.datasets.map((d) => `${d.module}:${d.set}`).join(', '),
      });
    }
    if (!this.holds(user, dataset.permission)) {
      throw new ForbiddenError('DATASHEETS.SIN_PERMISO_PARA_CONJUNTO', {
        dataset: `${module}:${set}`,
        permission: dataset.permission,
      });
    }

    const requested = (columns ?? []).filter((column) => column in dataset.columns);
    if (requested.length === 0) {
      throw new BadRequestError('DATASHEETS.COLUMNAS_NO_VALIDAS', {
        available: Object.keys(dataset.columns).join(', '),
      });
    }

    const resolved = resolvePaging(paging.page, paging.pageSize);
    const [rows, total] = await dataset.load(
      user.organizationId,
      resolved.take,
      resolved.skip,
    );

    const mapped = rows.map((row) => {
      const record = row as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const column of requested) {
        const value = record[dataset.columns[column]];
        // An absent value stays absent. Coercing it to `''` made a missing tax id and an empty one
        // indistinguishable in a sheet somebody then filters on.
        out[column] = value ?? null;
      }
      return out;
    });

    return toPage(mapped, total, resolved);
  }

  private holds(user: AuthenticatedUser, permission: string): boolean {
    return (user.roles ?? []).some((role: { permissions?: string[] }) =>
      (role.permissions ?? []).includes(permission),
    );
  }
}

/** A draft is not a document; a void one is not a sale. Neither belongs in an exported register. */
const ISSUED_INVOICE_STATUSES = [
  InvoiceStatus.PENDING,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PAID,
  InvoiceStatus.CREDIT_NOTE,
];
