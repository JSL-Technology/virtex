import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { Logger } from '@nestjs/common';
import { RequestContext } from 'nestjs-request-context';
import { ActionType, AuditLog } from './entities/audit-log.entity';

/**
 * Every change to a financial document leaves a row, in the transaction that made it.
 *
 * ## What was there
 *
 * An `AuditSubscriber` that was registered nowhere, listened to `Object` (so it would have audited
 * the audit log, sessions and password hashes alike), wrote through TypeORM 0.2's `getManager()`
 * outside any transaction, and stored the whole entity as its payload. It could not run, and if it
 * had, it would have been worse than nothing.
 *
 * Meanwhile `grep -rl AuditTrailService` returned nothing in accounts-payable, customers,
 * treasury, reconciliation, invoices, fixed-assets or budgets. Voiding a supplier bill, excluding
 * a bank transaction from a reconciliation, reopening a statement that had been reconciled,
 * changing a bank account, amending a budget: none of them left any trace at all.
 *
 * ## Why a subscriber rather than a call in each service
 *
 * Because the call in each service is what was missing. Seven modules mutate financial documents
 * and none of them remembered; the eighth module somebody writes next year will not remember
 * either. A subscriber cannot be forgotten, and it writes through `event.manager` — the caller's
 * own transaction — so the audit row commits with the change or rolls back with it. An audit row
 * that survives a rolled-back posting describes something that never happened; one that is lost
 * while the posting commits leaves a movement nobody is answerable for.
 *
 * ## What it does not do
 *
 * It audits documents, not their lines: an invoice with fifty items is one business event, and
 * fifty-one rows per issuance makes the trail unreadable, which is its own kind of failure. It
 * does not audit tables that already write purposeful rows of their own — journal entries record
 * what they posted and why, which is more than a diff of columns can say. And it records nothing
 * for a change made with no request behind it beyond the fact that the system made it, because
 * inventing an author is worse than admitting there is none.
 */
@EventSubscriber()
export class FinancialAuditSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger(FinancialAuditSubscriber.name);

  listenTo(): typeof Object {
    // Every entity reaches here and `shouldAudit` decides. TypeORM's per-entity subscription would
    // mean one class per table, and a list of tables in one place is the point.
    return Object;
  }

  async afterInsert(event: InsertEvent<unknown>): Promise<void> {
    await this.record(ActionType.CREATE, event.metadata.tableName, event.entity, null, event);
  }

  async afterUpdate(event: UpdateEvent<unknown>): Promise<void> {
    await this.record(
      ActionType.UPDATE,
      event.metadata.tableName,
      event.entity,
      event.databaseEntity,
      event,
    );
  }

  async afterRemove(event: RemoveEvent<unknown>): Promise<void> {
    await this.record(
      ActionType.DELETE,
      event.metadata.tableName,
      event.databaseEntity ?? event.entity,
      null,
      event,
    );
  }

  private async record(
    actionType: ActionType,
    tableName: string,
    entity: unknown,
    previous: unknown,
    event: { manager: InsertEvent<unknown>['manager'] },
  ): Promise<void> {
    if (!AUDITED_TABLES.has(tableName)) return;

    const record = entity as Record<string, unknown> | null | undefined;
    const entityId = record?.['id'];
    // A bulk update through the query builder carries no entity. There is nothing to identify, and
    // a row saying "some rows in this table changed" is not an audit trail. Those paths write
    // their own rows through `AuditTrailService.recordWithManager`.
    if (typeof entityId !== 'string') return;

    const request = RequestContext.currentContext?.req as
      | { user?: { id?: string; organizationId?: string }; ip?: string }
      | undefined;

    const organizationId =
      (typeof record?.['organizationId'] === 'string'
        ? (record['organizationId'] as string)
        : undefined) ?? request?.user?.organizationId ?? null;

    try {
      await event.manager.save(
        event.manager.create(AuditLog, {
          userId: request?.user?.id ?? null,
          organizationId,
          entity: tableName,
          entityId,
          actionType,
          ipAddress: request?.ip,
          newValue: this.payload(record ?? {}),
          previousValue: previous ? this.payload(previous as Record<string, unknown>) : undefined,
        }),
      );
    } catch (error) {
      // Deliberately not swallowed into silence: the trail failing is a defect, and a financial
      // change that cannot be audited should not be treated as routine. It is logged rather than
      // rethrown because a subscriber that aborts the transaction turns an audit problem into a
      // refused invoice, and the reconciliation of audit rows against documents is the control
      // that catches the gap.
      this.logger.error(
        `No se pudo registrar la auditoría de ${tableName}/${entityId} (${actionType}): ` +
          `${(error as Error).message}`,
      );
    }
  }

  /**
   * What goes in the payload.
   *
   * Relations are dropped — a loaded `invoice.lineItems` would put the whole document in every
   * row, and a lazily-loaded one would be a promise — and so is anything that is not a scalar.
   * What remains is the columns, which is what a diff is about.
   */
  private payload(entity: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entity)) {
      if (value === null || value === undefined) continue;
      const type = typeof value;
      if (type === 'string' || type === 'number' || type === 'boolean') out[key] = value;
      else if (value instanceof Date) out[key] = value.toISOString();
    }
    return out;
  }
}

/**
 * The document tables whose every change is recorded.
 *
 * Documents, not their lines: an invoice with fifty items is one business event. And not
 * `journal_entries`, which writes its own rows naming what it posted and on whose authority —
 * a column diff would say less, twice.
 */
const AUDITED_TABLES: ReadonlySet<string> = new Set([
  // Payables
  'vendor_bills',
  'vendor_payment',
  'vendor_debit_note',
  'payment_batches',
  // Receivables and sales
  'invoices',
  'customer_payments',
  'customers',
  // Treasury
  'bank_accounts',
  'bank_transfers',
  // Reconciliation
  'bank_statements',
  'bank_transactions',
  'reconciliation_rules',
  // Fixed assets
  'fixed_asset',
  // Budgets
  'budgets',
  'budget_lines',
  // The configuration that decides where money is posted, which is a financial change even though
  // it is not a document: moving the receivables account moves every future posting.
  'organization_settings',
  'tenant_withholding_regimes',
  'accounting_periods',
  'ledgers',
  'document_sequences',
]);
