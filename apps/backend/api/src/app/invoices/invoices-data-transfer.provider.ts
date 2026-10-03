import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { DataTransferDataset } from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { PERMISSIONS } from '../shared/permissions';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';

/** A draft is not a document; it does not belong in an exported register. */
const ISSUED = Not(In([InvoiceStatus.DRAFT]));

/**
 * Issued invoices, one row each — EXPORT ONLY (QA A-10). An invoice is issued with a fiscal
 * number and posted; it is never created from a spreadsheet.
 */
@Injectable()
export class InvoicesDataTransferProvider implements DataTransferDataset, OnModuleInit {
  readonly id = 'invoices';
  readonly labelKey = 'data_transfer.datasets.invoices';
  readonly viewPermission = PERMISSIONS.INVOICES_VIEW;
  readonly columns = [
    { key: 'numero', property: 'invoiceNumber' },
    { key: 'ncf', property: 'fiscalNumber' },
    { key: 'fecha', property: 'issueDate' },
    { key: 'vencimiento', property: 'dueDate' },
    { key: 'cliente', property: 'customerName' },
    { key: 'moneda', property: 'currencyCode' },
    { key: 'subtotal', property: 'subtotal' },
    { key: 'impuesto', property: 'tax' },
    { key: 'total', property: 'total' },
    { key: 'saldo', property: 'balance' },
    { key: 'estado', property: 'status' },
  ] as const;

  constructor(
    private readonly registry: DataTransferRegistry,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async exportPage(organizationId: string, take: number, skip: number) {
    const [rows, total] = await this.invoices.findAndCount({
      where: { organizationId, status: ISSUED },
      order: { issueDate: 'DESC', invoiceNumber: 'DESC' },
      take,
      skip,
    });
    return { rows: rows as unknown as Array<Record<string, unknown>>, total };
  }
}

/**
 * Sales detail: one row per line of every issued invoice — what was sold, to whom, when, at what
 * price and tax. EXPORT ONLY. What an analyst pivots on; the invoice register cannot answer
 * "how many of product X did we sell this quarter".
 */
@Injectable()
export class SalesLinesDataTransferProvider implements DataTransferDataset, OnModuleInit {
  readonly id = 'sales_lines';
  readonly labelKey = 'data_transfer.datasets.sales_lines';
  readonly viewPermission = PERMISSIONS.INVOICES_VIEW;
  readonly columns = [
    { key: 'numero', property: 'invoiceNumber' },
    { key: 'ncf', property: 'fiscalNumber' },
    { key: 'fecha', property: 'issueDate' },
    { key: 'cliente', property: 'customerName' },
    { key: 'moneda', property: 'currencyCode' },
    { key: 'descripcion', property: 'description' },
    { key: 'cantidad', property: 'quantity' },
    { key: 'unidad', property: 'unitOfMeasure' },
    { key: 'precio', property: 'price' },
    { key: 'descuento', property: 'discountAmount' },
    { key: 'subtotal', property: 'lineSubtotal' },
    { key: 'tasa_impuesto', property: 'taxRate' },
    { key: 'impuesto', property: 'taxAmount' },
  ] as const;

  constructor(
    private readonly registry: DataTransferRegistry,
    @InjectRepository(InvoiceLineItem) private readonly lines: Repository<InvoiceLineItem>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async exportPage(organizationId: string, take: number, skip: number) {
    const [lines, total] = await this.lines.findAndCount({
      where: { invoice: { organizationId, status: ISSUED } },
      relations: { invoice: true },
      order: { invoice: { issueDate: 'DESC', invoiceNumber: 'DESC' }, sortOrder: 'ASC' },
      take,
      skip,
    });
    const rows = lines.map((line) => ({
      ...line,
      invoiceNumber: line.invoice.invoiceNumber,
      fiscalNumber: line.invoice.fiscalNumber,
      issueDate: line.invoice.issueDate,
      customerName: line.invoice.customerName,
      currencyCode: line.invoice.currencyCode,
    }));
    return { rows: rows as unknown as Array<Record<string, unknown>>, total };
  }
}
