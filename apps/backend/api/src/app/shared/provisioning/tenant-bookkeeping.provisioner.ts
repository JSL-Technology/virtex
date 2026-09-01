import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { AccountRole } from '../../chart-of-accounts/enums/account-enums';
import { AccountingPeriod, PeriodStatus } from '../../accounting/entities/accounting-period.entity';
import { Journal, JournalType } from '../../journal-entries/entities/journal.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import {
  DocumentSequence,
  DocumentType,
} from '../document-sequences/entities/document-sequence.entity';

/**
 * Everything a tenant needs in order to record a transaction, created at the moment the tenant is.
 *
 * ## Why this exists
 *
 * A paid signup used to produce an organization with a chart of accounts, taxes, roles and a
 * subscription — and with `organization_settings`, `ledgers`, `journals`, `document_sequences` and
 * `accounting_periods` all empty. Those five tables are read by eleven services and were written by
 * none: there was no endpoint, no screen and no provisioning step that created a single row in any
 * of them. The observable consequence was that the first invoice a customer tried to issue failed
 * with "La configuración de cuentas automáticas para esta organización es incompleta", and the
 * first payment they tried to record failed with "Diario de Cobros (COBROS) no encontrado" — with
 * no way to fix either from the product.
 *
 * ## Design
 *
 * It runs inside the caller's transaction, on the `EntityManager` it is handed, so a tenant is
 * either fully able to keep books or does not exist. It talks to entities directly rather than to
 * the owning modules' services, which is what lets a single provisioner span accounting, journals,
 * organizations and shared sequences without a cycle between those modules.
 *
 * Every step is idempotent — the Stripe webhook and the browser redirect race each other on every
 * real signup, and both reach here — and every default account is resolved from
 * {@link AccountRole}, not from a name or a code, so it works identically for a Dominican chart in
 * Spanish, a US chart in English and a Brazilian chart in Portuguese.
 */
@Injectable()
export class TenantBookkeepingProvisioner {
  private readonly logger = new Logger(TenantBookkeepingProvisioner.name);

  /** The journals every tenant starts with, keyed by the code the product's services look up. */
  private static readonly JOURNALS: ReadonlyArray<{
    code: string;
    name: string;
    type: JournalType;
  }> = Object.freeze([
    { code: 'VENTAS', name: 'Diario de Ventas', type: 'SALES' },
    { code: 'COMPRAS', name: 'Diario de Compras', type: 'PURCHASES' },
    { code: 'COBROS', name: 'Diario de Cobros', type: 'BANK' },
    { code: 'PAGOS', name: 'Diario de Pagos', type: 'BANK' },
    { code: 'CAJA', name: 'Diario de Caja', type: 'CASH' },
    { code: 'GENERAL', name: 'Diario General', type: 'GENERAL' },
  ]);

  /** Prefixes for the internal document numbering. Fiscal numbering (NCF) is separate. */
  private static readonly SEQUENCES: ReadonlyArray<{ type: DocumentType; prefix: string }> =
    Object.freeze([
      { type: DocumentType.CUSTOMER_INVOICE, prefix: 'FAC-' },
      { type: DocumentType.QUOTE, prefix: 'COT-' },
      { type: DocumentType.CREDIT_NOTE, prefix: 'NC-' },
      { type: DocumentType.VENDOR_BILL, prefix: 'FP-' },
      { type: DocumentType.JOURNAL_ENTRY, prefix: 'AS-' },
    ]);

  /**
   * Provision the operational bookkeeping of a tenant. Call AFTER the chart of accounts exists —
   * the account roles it stamps are what the settings are derived from.
   */
  async provision(
    organization: Organization,
    baseCurrency: string,
    manager: EntityManager,
  ): Promise<void> {
    const organizationId = organization.id;

    await this.provisionSettings(organizationId, baseCurrency, manager);
    await this.provisionLedger(organizationId, baseCurrency, manager);
    await this.provisionJournals(organizationId, manager);
    await this.provisionDocumentSequences(organizationId, manager);
    await this.provisionAccountingPeriods(organizationId, new Date(), manager);

    this.logger.log(`Contabilidad operativa provisionada para la organización ${organizationId}.`);
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  /**
   * Resolve every account role the tenant's chart declares and write them into the settings row.
   *
   * A role the chart does not carry leaves its column null rather than aborting: the statutory
   * plans (Colombia's PUC, Peru's PCGE) are imported later and may name their accounts differently,
   * and a tenant that can post 90 % of its transactions beats one that cannot be created. The roles
   * the sales cycle actually requires are asserted by {@link assertCanInvoice}.
   */
  private async provisionSettings(
    organizationId: string,
    baseCurrency: string,
    manager: EntityManager,
  ): Promise<OrganizationSettings> {
    const repo = manager.getRepository(OrganizationSettings);
    const byRole = await this.accountsByRole(organizationId, manager);

    const existing = await repo.findOne({ where: { organizationId } });
    const settings = existing ?? repo.create({ organizationId });

    // An operator who re-pointed a role keeps their choice; only unset columns are filled in.
    settings.baseCurrency = existing?.baseCurrency ?? baseCurrency;
    settings.defaultAccountsReceivableId ??= byRole.get(AccountRole.ACCOUNTS_RECEIVABLE) ?? null;
    settings.defaultAccountsPayableId ??= byRole.get(AccountRole.ACCOUNTS_PAYABLE) ?? null;
    settings.defaultSalesRevenueId ??= byRole.get(AccountRole.SALES_REVENUE) ?? null;
    settings.defaultServiceRevenueId ??= byRole.get(AccountRole.SERVICE_REVENUE) ?? null;
    settings.defaultSalesTaxId ??= byRole.get(AccountRole.TAX_PAYABLE) ?? null;
    settings.defaultPurchaseTaxId ??= byRole.get(AccountRole.TAX_RECEIVABLE) ?? null;
    settings.defaultInventoryId ??= byRole.get(AccountRole.INVENTORY) ?? null;
    settings.defaultCostOfGoodsSoldId ??= byRole.get(AccountRole.COST_OF_GOODS_SOLD) ?? null;
    settings.defaultSalesDiscountsId ??= byRole.get(AccountRole.SALES_DISCOUNTS) ?? null;
    settings.defaultServiceChargePayableId ??= byRole.get(AccountRole.SERVICE_CHARGE_PAYABLE) ?? null;
    settings.defaultTaxWithheldReceivableId ??= byRole.get(AccountRole.WITHHOLDING_RECEIVABLE) ?? null;
    settings.defaultTaxWithheldPayableId ??= byRole.get(AccountRole.WITHHOLDING_PAYABLE) ?? null;
    settings.defaultCashId ??= byRole.get(AccountRole.CASH) ?? null;
    settings.defaultBankId ??= byRole.get(AccountRole.BANK) ?? null;
    settings.defaultRetainedEarningsAccountId ??= byRole.get(AccountRole.RETAINED_EARNINGS) ?? null;
    settings.defaultForexGainLossAccountId ??= byRole.get(AccountRole.FOREX_GAIN_LOSS) ?? null;
    settings.defaultDepreciationExpenseAccountId ??= byRole.get(AccountRole.DEPRECIATION_EXPENSE) ?? null;
    settings.defaultAccumulatedDepreciationAccountId ??= byRole.get(AccountRole.ACCUMULATED_DEPRECIATION) ?? null;
    settings.defaultInflationAdjustmentAccountId ??= byRole.get(AccountRole.INFLATION_ADJUSTMENT) ?? null;

    return repo.save(settings);
  }

  /** All role-tagged accounts of a tenant, as role → account id. */
  private async accountsByRole(
    organizationId: string,
    manager: EntityManager,
  ): Promise<Map<AccountRole, string>> {
    const rows = await manager
      .getRepository(Account)
      .createQueryBuilder('account')
      .select(['account.id', 'account.systemRole'])
      .where('account.organizationId = :organizationId', { organizationId })
      .andWhere('account.systemRole IS NOT NULL')
      .getMany();

    const map = new Map<AccountRole, string>();
    for (const row of rows) {
      if (row.systemRole) map.set(row.systemRole, row.id);
    }
    return map;
  }

  // ── Ledger ─────────────────────────────────────────────────────────────────

  private async provisionLedger(
    organizationId: string,
    baseCurrency: string,
    manager: EntityManager,
  ): Promise<Ledger> {
    const repo = manager.getRepository(Ledger);
    const existing = await repo.findOne({ where: { organizationId, isDefault: true } });
    if (existing) return existing;

    return repo.save(
      repo.create({
        organizationId,
        name: 'Libro Principal',
        description: 'Libro contable principal, en la moneda funcional de la organización.',
        currency: baseCurrency,
        isDefault: true,
        isActive: true,
      }),
    );
  }

  // ── Journals ───────────────────────────────────────────────────────────────

  private async provisionJournals(organizationId: string, manager: EntityManager): Promise<void> {
    const repo = manager.getRepository(Journal);
    const existing = await repo.find({ where: { organizationId }, select: ['code'] });
    const known = new Set(existing.map((j) => j.code));

    const missing = TenantBookkeepingProvisioner.JOURNALS.filter((j) => !known.has(j.code));
    if (missing.length === 0) return;

    await repo.save(missing.map((j) => repo.create({ organizationId, ...j })));
  }

  // ── Document sequences ─────────────────────────────────────────────────────

  private async provisionDocumentSequences(
    organizationId: string,
    manager: EntityManager,
  ): Promise<void> {
    const repo = manager.getRepository(DocumentSequence);
    const existing = await repo.find({ where: { organizationId }, select: ['type'] });
    const known = new Set(existing.map((s) => s.type));

    const missing = TenantBookkeepingProvisioner.SEQUENCES.filter((s) => !known.has(s.type));
    if (missing.length === 0) return;

    await repo.save(
      missing.map((s) =>
        repo.create({ organizationId, type: s.type, prefix: s.prefix, nextNumber: 1 }),
      ),
    );
  }

  // ── Accounting periods ─────────────────────────────────────────────────────

  /**
   * Twelve monthly periods for the calendar year the tenant is created in, all open.
   *
   * `PeriodLockGuard` treats "no periods at all" as permissive, which meant every tenant operated
   * with no period control whatsoever and the first period a user created retroactively locked
   * every transaction dated outside it. Creating the year up front makes the guard meaningful from
   * the first document, and makes the year-end close a real operation rather than a no-op.
   */
  async provisionAccountingPeriods(
    organizationId: string,
    reference: Date,
    manager: EntityManager,
  ): Promise<number> {
    const repo = manager.getRepository(AccountingPeriod);
    const year = reference.getUTCFullYear();

    const existing = await repo
      .createQueryBuilder('p')
      .where('p.organizationId = :organizationId', { organizationId })
      .andWhere('EXTRACT(YEAR FROM p.startDate) = :year', { year })
      .getCount();
    if (existing > 0) return 0;

    const periods = Array.from({ length: 12 }, (_, index) => {
      const start = new Date(Date.UTC(year, index, 1));
      const end = new Date(Date.UTC(year, index + 1, 0));
      return repo.create({
        organizationId,
        name: `${MONTHS_ES[index]} ${year}`,
        startDate: start,
        endDate: end,
        status: PeriodStatus.OPEN,
        generalLedgerStatus: PeriodStatus.OPEN,
        accountsPayableStatus: PeriodStatus.OPEN,
        accountsReceivableStatus: PeriodStatus.OPEN,
        inventoryStatus: PeriodStatus.OPEN,
      });
    });

    await repo.save(periods);
    return periods.length;
  }

  /**
   * Assert that the tenant can actually issue a sales document, naming precisely what is missing.
   *
   * Used by the provisioning verifier and by the readiness endpoint, so "can this tenant invoice?"
   * has one answer computed in one place instead of being discovered as a 400 at the till.
   */
  async assertCanInvoice(organizationId: string, manager: EntityManager): Promise<void> {
    const missing = await this.invoicingGaps(organizationId, manager);
    if (missing.length > 0) {
      throw new InternalServerErrorException(
        `La organización no está lista para facturar. Falta: ${missing.join('; ')}.`,
      );
    }
  }

  /** Human-readable list of what stops this tenant from invoicing. Empty means ready. */
  async invoicingGaps(organizationId: string, manager: EntityManager): Promise<string[]> {
    const gaps: string[] = [];

    const settings = await manager
      .getRepository(OrganizationSettings)
      .findOne({ where: { organizationId } });
    if (!settings) {
      gaps.push('la configuración contable de la organización');
    } else {
      if (!settings.defaultAccountsReceivableId) gaps.push('la cuenta de Cuentas por Cobrar');
      if (!settings.defaultSalesRevenueId) gaps.push('la cuenta de Ingresos por Ventas');
      if (!settings.defaultSalesTaxId) gaps.push('la cuenta de Impuesto sobre Ventas por Pagar');
    }

    const ledgers = await manager
      .getRepository(Ledger)
      .count({ where: { organizationId, isDefault: true } });
    if (ledgers === 0) gaps.push('el libro contable por defecto');

    const salesJournal = await manager
      .getRepository(Journal)
      .count({ where: { organizationId, code: 'VENTAS' } });
    if (salesJournal === 0) gaps.push('el diario de ventas (VENTAS)');

    const sequences = await manager
      .getRepository(DocumentSequence)
      .count({ where: { organizationId, type: DocumentType.CUSTOMER_INVOICE } });
    if (sequences === 0) gaps.push('la secuencia de numeración de facturas');

    return gaps;
  }
}

const MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;
