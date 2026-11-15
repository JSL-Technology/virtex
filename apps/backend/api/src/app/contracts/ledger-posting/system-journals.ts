/**
 * The journals the product itself posts to, each with the code it is found by.
 *
 * Every company is provisioned with exactly these (`TenantBookkeepingProvisioner`), and a posting
 * or a lookup names its journal through this catalogue — `journalCode` and `JournalLookupService`
 * take a {@link SystemJournalCode}, so a code nobody provisions does not compile.
 *
 * It had to be made impossible because it kept happening. A service named its journal with a string
 * literal that no provisioning created, and the operation answered «journal not found» on every
 * company the product had ever made: BANCOS (treasury), then DEPREC, CIERRE and CONCIL (QA C-06),
 * then ACT-FIJOS — every fixed-asset disposal (FINB-10) — and AJU-INF, the inflation adjustment.
 * Each time the fix was one more line in the provisioner and one more backfill; the list was in one
 * place and the codes in another.
 *
 * The code is an identifier, not a label: what a person reads is `nameKey`, resolved into the
 * books language when the company is created.
 */

/** Mirrors the journal entity's `JournalType`; a string union here so contracts import no entity. */
export type SystemJournalType = 'SALES' | 'PURCHASES' | 'CASH' | 'BANK' | 'GENERAL';

export interface SystemJournalDefinition {
  readonly code: string;
  readonly nameKey: string;
  readonly type: SystemJournalType;
}

export const SYSTEM_JOURNALS = {
  sales: { code: 'VENTAS', nameKey: 'ledger.provisioning.journals.sales', type: 'SALES' },
  purchases: { code: 'COMPRAS', nameKey: 'ledger.provisioning.journals.purchases', type: 'PURCHASES' },
  collections: { code: 'COBROS', nameKey: 'ledger.provisioning.journals.collections', type: 'BANK' },
  payments: { code: 'PAGOS', nameKey: 'ledger.provisioning.journals.payments', type: 'BANK' },
  /** Opening entries of bank accounts and transfers between them. */
  banks: { code: 'BANCOS', nameKey: 'ledger.provisioning.journals.banks', type: 'BANK' },
  cash: { code: 'CAJA', nameKey: 'ledger.provisioning.journals.cash', type: 'CASH' },
  payroll: { code: 'NOMINA', nameKey: 'ledger.provisioning.journals.payroll', type: 'GENERAL' },
  general: { code: 'GENERAL', nameKey: 'ledger.provisioning.journals.general', type: 'GENERAL' },
  /** The monthly depreciation every period close runs. */
  depreciation: { code: 'DEPREC', nameKey: 'ledger.provisioning.journals.depreciation', type: 'GENERAL' },
  /** The year-end result transfer and the closing adjustments. */
  closing: { code: 'CIERRE', nameKey: 'ledger.provisioning.journals.closing', type: 'GENERAL' },
  /** Adjustments a reconciliation rule posts. */
  reconciliation: { code: 'CONCIL', nameKey: 'ledger.provisioning.journals.reconciliation', type: 'BANK' },
  /** Disposals of fixed assets: cost and accumulated depreciation out, proceeds and result in. */
  fixedAssets: { code: 'ACT-FIJOS', nameKey: 'ledger.provisioning.journals.fixed_assets', type: 'GENERAL' },
  /** Restatement of the accounts marked for inflation adjustment. */
  inflationAdjustment: { code: 'AJU-INF', nameKey: 'ledger.provisioning.journals.inflation_adjustment', type: 'GENERAL' },
} as const satisfies Record<string, SystemJournalDefinition>;

/** The code of a journal every company has. */
export type SystemJournalCode = (typeof SYSTEM_JOURNALS)[keyof typeof SYSTEM_JOURNALS]['code'];
