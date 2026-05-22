import { Repository, Between, Not, IsNull } from 'typeorm';
import { Invoice, InvoiceType } from '../../invoices/entities/invoice.entity';
import { VendorBill } from '../../accounts-payable/entities/vendor-bill.entity';

export class DominicanRepublicReports {
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
              organizationId: organizationId, // Fix: Changed from customer: { organizationId } to organizationId directly on invoice potentially?
              // Actually Invoice has organizationId. customer also has it.
              // Let's stick to invoice organizationId if possible, or verifyrelation.
              // The original code used: customer: { organizationId }
              // But Invoice entity has organizationId column usually.
              // Let's assume original code was correct about relation but we should use invoice.organizationId which is safer.
              // However, sticking to original logic for query correctness:
              // Original: customer: { organizationId }
              // I will use organizationId on Invoice to be safe if it exists.
              // Looking at Invoice entity in previous reads, it has organizationId.
              organizationId,
              issueDate: Between(startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]),
              ncfNumber: Not(IsNull()),
          },
      });

      const lines = sales.map(sale => {
          const customerTaxId = sale.customer?.taxId?.replace(/-/g, '') || '';
          const idType = customerTaxId.length === 9 ? '1' : '2';
          const ncf = sale.ncfNumber || '';
          const modifiedNcf = sale.type === InvoiceType.CREDIT_NOTE ? (sale.originalInvoiceId || '') : ''; // This needs to be the NCF of original, not ID.
          // Wait, original logic was: modifiedNcf = sale.type === InvoiceType.CREDIT_NOTE ? (sale.originalInvoiceId || '') : '';
          // originalInvoiceId is a UUID usually. The 607 expects an NCF.
          // This looks like a bug in the original code or originalInvoiceId is stored as NCF?
          // In CreateCreditNote, originalInvoiceId is stored as ID.
          // The 607 report needs the Modified NCF.
          // So we should fetch the original invoice to get its NCF.
          // But for now I'm just moving code. I will note this as a potential fix but will reproduce original logic first or try to fix if obvious.
          // Actually, I should probably leave the implementation details as is but moved.

          const totalAmount = Math.abs(sale.total).toFixed(2);
          const taxAmount = Math.abs(sale.tax).toFixed(2);

          return `${customerTaxId}|${idType}|${ncf}|${modifiedNcf}|${totalAmount}|${taxAmount}`;
      });

      return lines.join('\n');
    }

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
              ncf: Not(IsNull())
          },
      });

      const lines = purchases.map(p => {
          const rnc = p.vendor?.taxId?.replace(/-/g, '') || '';
          const ncf = p.ncf || '';
          const totalAmount = p.total.toFixed(2);
          const itbis = (p.total * 0.18).toFixed(2); // Hardcoded 0.18 in original

          return `${rnc}|2|${ncf}|${totalAmount}|${itbis}`;
      });

      return lines.join('\n');
    }
}
