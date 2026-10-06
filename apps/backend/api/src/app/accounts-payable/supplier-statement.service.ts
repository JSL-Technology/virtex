import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { organizationBaseCurrency } from '../organizations/contracts/base-currency.contract';
import { NotFoundError } from '../i18n/localized.exception';
import { loadBranchScope } from '../organizations/contracts/branch.contract';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { PartnerStatement, branchPredicate, buildPartnerStatement } from '../shared/statements/partner-statement';
import { StatementQueryDto } from '../shared/statements/statement-query.dto';

/**
 * A supplier's statement of account (audit H-17): every posted bill, payment and debit note — and
 * each one's annulment on the day its reversal was booked — with what is owed after each.
 * Positive amounts increase what the company owes the supplier.
 */
@Injectable()
export class SupplierStatementService {
  constructor(private readonly dataSource: DataSource) {}

  async statement(
    organizationId: string,
    supplierId: string,
    query: StatementQueryDto,
    actorUserId: string | null,
  ): Promise<PartnerStatement & { partnerName: string }> {
    const manager = this.dataSource.manager;
    const supplier = await manager.findOne(Supplier, { where: { id: supplierId, organizationId } });
    if (!supplier) throw new NotFoundError('procurement.supplier_not_found');
    const scope = await loadBranchScope(manager, organizationId, actorUserId);
    const branch = branchPredicate(scope.allowed, 3);
    const today = await organizationToday(manager, organizationId);
    const reversalDate = (alias: string) =>
      `COALESCE((SELECT je.date FROM journal_entries je WHERE je.id = ${alias}.reversal_journal_entry_id), (${alias}.voided_at AT TIME ZONE 'UTC')::date)`;
    const scoped = (alias: string) => branch.sql.replace('branch_id', `${alias}.branch_id`);

    // What a bill made payable: its total less what was withheld from the supplier.
    const movementsSql = `
      SELECT b.date, 'bill' AS kind, b.id AS document_id, b.ncf AS reference,
             b.total - b.tax_withheld - b.income_tax_withheld AS amount, b.currency_code
        FROM vendor_bills b
       WHERE b.organization_id = $1 AND b.vendor_id = $2 AND b.journal_entry_id IS NOT NULL${scoped('b')}
      UNION ALL
      SELECT ${reversalDate('b')}, 'bill_void', b.id, b.ncf,
             -(b.total - b.tax_withheld - b.income_tax_withheld), b.currency_code
        FROM vendor_bills b
       WHERE b.organization_id = $1 AND b.vendor_id = $2 AND b.status = 'VOID'
         AND b.journal_entry_id IS NOT NULL${scoped('b')}
      UNION ALL
      SELECT pb.payment_date, 'payment', pb.id, pb.number, -SUM(vp.amount), b.currency_code
        FROM payment_batches pb
        JOIN vendor_payment vp ON vp.payment_batch_id = pb.id
        JOIN vendor_bills b ON b.id = vp.vendor_bill_id
       WHERE pb.organization_id = $1 AND b.vendor_id = $2 AND pb.status IN ('PAID', 'VOID')${scoped('pb')}
       GROUP BY pb.id, b.currency_code
      UNION ALL
      SELECT ${reversalDate('pb')}, 'payment_void', pb.id, pb.number, SUM(vp.amount), b.currency_code
        FROM payment_batches pb
        JOIN vendor_payment vp ON vp.payment_batch_id = pb.id
        JOIN vendor_bills b ON b.id = vp.vendor_bill_id
       WHERE pb.organization_id = $1 AND b.vendor_id = $2 AND pb.status = 'VOID'${scoped('pb')}
       GROUP BY pb.id, b.currency_code
      UNION ALL
      SELECT n.date, 'vendor_debit_note', n.id, n.number, -n.amount, b.currency_code
        FROM vendor_debit_note n
        JOIN vendor_bills b ON b.id = n.vendor_bill_id
       WHERE n.organization_id = $1 AND b.vendor_id = $2${scoped('n')}
      UNION ALL
      SELECT ${reversalDate('n')}, 'vendor_debit_note_void', n.id, n.number, n.amount, b.currency_code
        FROM vendor_debit_note n
        JOIN vendor_bills b ON b.id = n.vendor_bill_id
       WHERE n.organization_id = $1 AND b.vendor_id = $2 AND n.status = 'VOIDED'${scoped('n')}`;

    const statement = await buildPartnerStatement(manager, {
      organizationId,
      partnerId: supplierId,
      movementsSql,
      params: branch.params,
      from: (query.from ?? `${today.slice(0, 4)}-01-01`).slice(0, 10),
      to: (query.to ?? today).slice(0, 10),
      currencyCode: query.currency ?? null,
      baseCurrency: await organizationBaseCurrency(manager, organizationId),
    });
    return { ...statement, partnerName: supplier.name };
  }
}
