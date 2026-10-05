import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { organizationBaseCurrency } from '../organizations/contracts/base-currency.contract';
import { NotFoundError } from '../i18n/localized.exception';
import { loadBranchScope } from '../organizations/contracts/branch.contract';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { PartnerStatement, branchPredicate, buildPartnerStatement } from '../shared/statements/partner-statement';
import { StatementQueryDto } from '../shared/statements/statement-query.dto';

/**
 * A customer's statement of account (audit H-17): every issued invoice and debit note, credit
 * note and receipt — and each receipt's reversal, on the day it was voided — with the balance
 * after each. What the customer owes on any date, and why.
 */
@Injectable()
export class CustomerStatementService {
  constructor(private readonly dataSource: DataSource) {}

  async statement(
    organizationId: string,
    customerId: string,
    query: StatementQueryDto,
    actorUserId: string | null,
  ): Promise<PartnerStatement & { partnerName: string }> {
    const manager = this.dataSource.manager;
    const customer = await manager.findOne(Customer, { where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundError('customers.customer_not_found');
    const scope = await loadBranchScope(manager, organizationId, actorUserId);
    const branch = branchPredicate(scope.allowed, 3);
    const today = await organizationToday(manager, organizationId);

    // Issued documents only: a draft, or one voided before it was issued, never reached the ledger.
    const movementsSql = `
      SELECT "issueDate" AS date,
             CASE type WHEN 'CREDIT_NOTE' THEN 'credit_note' WHEN 'DEBIT_NOTE' THEN 'debit_note' ELSE 'invoice' END AS kind,
             id AS document_id,
             COALESCE(fiscal_number, "invoiceNumber") AS reference,
             CASE type WHEN 'CREDIT_NOTE' THEN -1 ELSE 1 END * COALESCE(net_receivable, total) AS amount,
             currency_code
        FROM invoices
       WHERE organization_id = $1 AND customer_id = $2 AND journal_entry_id IS NOT NULL${branch.sql}
      UNION ALL
      SELECT payment_date, 'receipt', id, receipt_number,
             -((SELECT COALESCE(SUM(l.amount), 0) FROM customer_payment_lines l WHERE l.payment_id = p.id)
               + unapplied_amount - advance_applied_amount),
             currency_code
        FROM customer_payments p
       WHERE organization_id = $1 AND customer_id = $2${branch.sql}
      UNION ALL
      SELECT COALESCE((SELECT je.date FROM journal_entries je WHERE je.id = p.reversal_journal_entry_id),
                      (voided_at AT TIME ZONE 'UTC')::date),
             'receipt_void', id, receipt_number,
             (SELECT COALESCE(SUM(l.amount), 0) FROM customer_payment_lines l WHERE l.payment_id = p.id)
               + unapplied_amount - advance_applied_amount,
             currency_code
        FROM customer_payments p
       WHERE organization_id = $1 AND customer_id = $2 AND status = 'VOID'${branch.sql}`;

    const statement = await buildPartnerStatement(manager, {
      organizationId,
      partnerId: customerId,
      movementsSql,
      params: branch.params,
      from: (query.from ?? `${today.slice(0, 4)}-01-01`).slice(0, 10),
      to: (query.to ?? today).slice(0, 10),
      currencyCode: query.currency ?? null,
      baseCurrency: await organizationBaseCurrency(manager, organizationId),
    });
    return { ...statement, partnerName: customer.companyName };
  }
}
