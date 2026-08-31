import { Repository, Between, Not, IsNull, In } from 'typeorm';
import { Invoice, InvoiceType } from '../../invoices/entities/invoice.entity';
import { VendorBill } from '../../accounts-payable/entities/vendor-bill.entity';

/**
 * DGII fiscal reports for the Dominican Republic (formatos de envío 606 / 607).
 *
 * The output is the pipe-delimited detail body the DGII expects. Header lines (RNC, período,
 * cantidad de registros, totales) are added by the caller/controller so the same body can be
 * streamed or checksummed independently.
 */
export class DominicanRepublicReports {
    /**
     * 607 — Ventas de bienes y servicios (comprobantes emitidos).
     */
    static async generate607Report(
        organizationId: string,
        year: number,
        month: number,
        invoiceRepository: Repository<Invoice>
    ): Promise<string> {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      const sales = await invoiceRepository.find({
          relations: ['customer'],
          where: {
              organizationId,
              issueDate: Between(startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]),
              ncfNumber: Not(IsNull()),
          },
      });

      // The 607 "NCF modificado" column must carry the *NCF* of the comprobante being modified, not
      // its primary key. Credit notes store `originalInvoiceId` (a UUID), so we resolve those to the
      // original invoices' NCFs in a single batched query and look them up per line.
      const originalIds = Array.from(
          new Set(
              sales
                  .filter((s) => s.type === InvoiceType.CREDIT_NOTE && s.originalInvoiceId)
                  .map((s) => s.originalInvoiceId as string),
          ),
      );

      const originalNcfById = new Map<string, string>();
      if (originalIds.length > 0) {
          const originals = await invoiceRepository.find({
              where: { organizationId, id: In(originalIds) },
              select: ['id', 'ncfNumber'],
          });
          for (const o of originals) {
              if (o.ncfNumber) originalNcfById.set(o.id, o.ncfNumber);
          }
      }

      const lines = sales.map((sale) => {
          const customerTaxId = sale.customer?.taxId?.replace(/-/g, '') || '';
          // 1 = RNC (9 dígitos), 2 = Cédula (11 dígitos). Empty tax id → left blank.
          const idType = customerTaxId.length === 9 ? '1' : customerTaxId.length === 11 ? '2' : '';
          const ncf = sale.ncfNumber || '';
          const modifiedNcf =
              sale.type === InvoiceType.CREDIT_NOTE && sale.originalInvoiceId
                  ? originalNcfById.get(sale.originalInvoiceId) || ''
                  : '';

          const totalAmount = Math.abs(Number(sale.total)).toFixed(2);
          const taxAmount = Math.abs(Number(sale.tax)).toFixed(2);

          return `${customerTaxId}|${idType}|${ncf}|${modifiedNcf}|${totalAmount}|${taxAmount}`;
      });

      return lines.join('\n');
    }

    /**
     * 606 — Compras de bienes y servicios (comprobantes recibidos de proveedores).
     */
    static async generate606Report(
        organizationId: string,
        year: number,
        month: number,
        vendorBillRepository: Repository<VendorBill>
    ): Promise<string> {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      const purchases = await vendorBillRepository.find({
          relations: ['vendor'],
          where: {
              organizationId,
              date: Between(startDate, endDate),
              ncf: Not(IsNull()),
          },
      });

      const lines = purchases.map((p) => {
          const rnc = p.vendor?.taxId?.replace(/-/g, '') || '';
          const ncf = p.ncf || '';
          const total = Number(p.total);
          // `VendorBill.total` is ITBIS-inclusive but the entity carries no tax/base breakdown, so
          // the previous `total * 0.18` was doubly wrong: it added 18% on top of an already-taxed
          // total and assumed every purchase is taxable. We derive the embedded ITBIS by reversing
          // the standard 18% rate from the inclusive total. NOTE (cross-module): a compliant 606
          // needs a per-bill taxable base / ITBIS / exempt breakdown captured in the Accounts
          // Payable module; this reverse calculation is a stopgap until that field exists.
          const base = total / 1.18;
          const itbis = (total - base).toFixed(2);
          const totalAmount = total.toFixed(2);

          return `${rnc}|2|${ncf}|${totalAmount}|${itbis}`;
      });

      return lines.join('\n');
    }
}
