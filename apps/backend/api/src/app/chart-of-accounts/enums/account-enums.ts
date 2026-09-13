

export enum AccountType {
    ASSET = 'ASSET',
    LIABILITY = 'LIABILITY',
    EQUITY = 'EQUITY',
    REVENUE = 'REVENUE',
    EXPENSE = 'EXPENSE',
}

export enum AccountNature {
    DEBIT = 'DEBIT',
    CREDIT = 'CREDIT',
}

export enum AccountCategory {

    CURRENT_ASSET = 'CURRENT_ASSET',
    NON_CURRENT_ASSET = 'NON_CURRENT_ASSET',


    CURRENT_LIABILITY = 'CURRENT_LIABILITY',
    NON_CURRENT_LIABILITY = 'NON_CURRENT_LIABILITY',


    OWNERS_EQUITY = 'OWNERS_EQUITY',
    RETAINED_EARNINGS = 'RETAINED_EARNINGS',


    OPERATING_REVENUE = 'OPERATING_REVENUE',
    NON_OPERATING_REVENUE = 'NON_OPERATING_REVENUE',


    OPERATING_EXPENSE = 'OPERATING_EXPENSE',
    NON_OPERATING_EXPENSE = 'NON_OPERATING_EXPENSE',
    COST_OF_GOODS_SOLD = 'COST_OF_GOODS_SOLD',
}



export const AccountTypeTranslations = {
    [AccountType.ASSET]: { en: 'Asset', es: 'Activo' },
    [AccountType.LIABILITY]: { en: 'Liability', es: 'Pasivo' },
    [AccountType.EQUITY]: { en: 'Equity', es: 'Patrimonio' },
    [AccountType.REVENUE]: { en: 'Revenue', es: 'Ingresos' },
    [AccountType.EXPENSE]: { en: 'Expense', es: 'Gastos' },
};

export const AccountCategoryTranslations = {

    [AccountCategory.CURRENT_ASSET]: { en: 'Current Asset', es: 'Activo Corriente' },
    [AccountCategory.NON_CURRENT_ASSET]: { en: 'Non-Current Asset', es: 'Activo No Corriente' },


    [AccountCategory.CURRENT_LIABILITY]: { en: 'Current Liability', es: 'Pasivo Corriente' },
    [AccountCategory.NON_CURRENT_LIABILITY]: { en: 'Non-Current Liability', es: 'Pasivo No Corriente' },


    [AccountCategory.OWNERS_EQUITY]: { en: 'Owner\'s Equity', es: 'Patrimonio de Propietarios' },
    [AccountCategory.RETAINED_EARNINGS]: { en: 'Retained Earnings', es: 'Ganancias Retenidas' },


    [AccountCategory.OPERATING_REVENUE]: { en: 'Operating Revenue', es: 'Ingresos Operativos' },
    [AccountCategory.NON_OPERATING_REVENUE]: { en: 'Non-Operating Revenue', es: 'Ingresos No Operativos' },


    [AccountCategory.OPERATING_EXPENSE]: { en: 'Operating Expense', es: 'Gasto Operativo' },
    [AccountCategory.NON_OPERATING_EXPENSE]: { en: 'Non-Operating Expense', es: 'Gasto No Operativo' },
    [AccountCategory.COST_OF_GOODS_SOLD]: { en: 'Cost of Goods Sold', es: 'Costo de Bienes Vendidos' },
};



export enum CashFlowCategory {
    OPERATING = 'OPERATING',
    INVESTING = 'INVESTING',
    FINANCING = 'FINANCING',
    NONE = 'NONE',
}

export enum RequiredDimension {
    COST_CENTER = 'COST_CENTER',
    PROJECT = 'PROJECT',
    SEGMENT = 'SEGMENT',
}

export enum HierarchyType {
    LEGAL = 'LEGAL',
    MANAGEMENT = 'MANAGEMENT',
    FISCAL = 'FISCAL',
}
/**
 * The operational job an account does, independent of its name, its code and the language it was
 * created in.
 *
 * Every automatic posting in the product — a sale, a collection, a purchase, a depreciation run —
 * needs to reach a specific account, and until now the only ways to find one were its localized
 * name or a hardcoded code. Both break the moment a tenant renames an account, translates its
 * chart, or imports a statutory plan whose codes differ (Colombia's PUC writes `1305`, not `1130`).
 *
 * The role is stamped by the chart-of-accounts template at provisioning time and is unique per
 * organization, so `OrganizationSettings` is derived from it deterministically rather than guessed.
 * A tenant may re-point a role to a different account; what it cannot do is leave the product
 * without one and discover it at the moment of issuing an invoice.
 */
export enum AccountRole {
  CASH = 'CASH',
  BANK = 'BANK',
  ACCOUNTS_RECEIVABLE = 'ACCOUNTS_RECEIVABLE',
  DOUBTFUL_ALLOWANCE = 'DOUBTFUL_ALLOWANCE',
  INVENTORY = 'INVENTORY',
  /** VAT/ITBIS/IVA borne on purchases — the credit side of the tax return. */
  TAX_RECEIVABLE = 'TAX_RECEIVABLE',
  /** Tax withheld from us by our customers, recoverable against the return. */
  WITHHOLDING_RECEIVABLE = 'WITHHOLDING_RECEIVABLE',
  ACCOUNTS_PAYABLE = 'ACCOUNTS_PAYABLE',
  /** VAT/ITBIS/IVA charged on sales — the debit side of the tax return. */
  TAX_PAYABLE = 'TAX_PAYABLE',
  /**
   * Excise duty charged on sales (ISC in the Dominican Republic, IEPS in Mexico, ICE in Ecuador).
   *
   * A separate liability from the consumption tax, and separately declarable: the tax engine
   * computed it per line, the invoice dropped it on the floor, and the ledger entry was then out of
   * balance by exactly the excise on any document that carried one.
   */
  EXCISE_TAX_PAYABLE = 'EXCISE_TAX_PAYABLE',
  /** Tax we withhold from third parties and must remit. */
  WITHHOLDING_PAYABLE = 'WITHHOLDING_PAYABLE',
  /** Legally mandated service charge (propina legal in DO/CR): collected for staff, never revenue. */
  SERVICE_CHARGE_PAYABLE = 'SERVICE_CHARGE_PAYABLE',
  /**
   * Money received from a customer that no document has been applied to yet.
   *
   * An advance is a LIABILITY — we owe goods or a refund — not a negative receivable. Crediting it
   * to `ACCOUNTS_RECEIVABLE` was arithmetically convenient and wrong twice over: it drove the
   * control account below zero (an asset cannot be negative on a balance sheet), and it broke the
   * one reconciliation the ageing report performs, because the subledger lists open invoices and
   * knows nothing about an advance that belongs to no invoice.
   */
  CUSTOMER_ADVANCES = 'CUSTOMER_ADVANCES',
  RETAINED_EARNINGS = 'RETAINED_EARNINGS',
  /**
   * The counterpart for balances that existed before the books did.
   *
   * Opening stock, an opening bank balance, a receivable carried over from the previous system:
   * each debits its asset and needs a credit somewhere. It cannot be retained earnings — that
   * would report a prior period's result as this one's — so it gets its own equity account, which
   * the accountant clears against capital or retained earnings once the opening balance sheet is
   * agreed. This is the same account QuickBooks calls "Opening Balance Equity" and Xero calls
   * "Historical Adjustment", for the same reason.
   */
  OPENING_BALANCE_EQUITY = 'OPENING_BALANCE_EQUITY',
  SALES_REVENUE = 'SALES_REVENUE',
  SERVICE_REVENUE = 'SERVICE_REVENUE',
  SALES_DISCOUNTS = 'SALES_DISCOUNTS',
  COST_OF_GOODS_SOLD = 'COST_OF_GOODS_SOLD',
  /**
   * Where a change in on-hand quantity that is not a purchase or a sale lands: a stock count that
   * disagrees with the books, breakage, theft, a correction to a miskeyed quantity.
   *
   * Without it, editing a product's stock moved a real asset with no counterpart anywhere, so the
   * inventory figure on the balance sheet and the quantity in the warehouse drifted apart with
   * nothing to explain the difference. Kept out of cost of goods sold on purpose: shrinkage is not
   * a cost of what was sold, and margin analysis that mixes the two is worthless.
   */
  INVENTORY_ADJUSTMENT = 'INVENTORY_ADJUSTMENT',
  ACCUMULATED_DEPRECIATION = 'ACCUMULATED_DEPRECIATION',
  DEPRECIATION_EXPENSE = 'DEPRECIATION_EXPENSE',
  FOREX_GAIN_LOSS = 'FOREX_GAIN_LOSS',
  INFLATION_ADJUSTMENT = 'INFLATION_ADJUSTMENT',

  // ── Payroll ─────────────────────────────────────────────────────────────────
  //
  // A payroll run debits salary expense and the employer's own social-security cost, and credits a
  // liability for each thing it owes to someone other than the employee: the net wage, each social
  // fund, and the income tax withheld. They are separate roles, not one "payroll payable", because
  // each is remitted to a different body on a different schedule (TSS, DGII, the employee's bank)
  // and a ledger that nets them cannot answer "how much do we owe TSS this month".

  /** Gross remuneration expense — the debit side of every payroll run. */
  SALARY_EXPENSE = 'SALARY_EXPENSE',
  /** The employer's own contributions (SFS, AFP, SRL, INFOTEP), an expense distinct from the wage. */
  EMPLOYER_CONTRIBUTIONS_EXPENSE = 'EMPLOYER_CONTRIBUTIONS_EXPENSE',
  /** Net wages owed to employees until the payment run settles them. */
  PAYROLL_NET_PAYABLE = 'PAYROLL_NET_PAYABLE',
  /** Pension fund (AFP) — employee share withheld plus employer share — owed to the TSS. */
  AFP_PAYABLE = 'AFP_PAYABLE',
  /** Health fund (SFS/SDSS) — employee share withheld plus employer share — owed to the TSS. */
  SFS_PAYABLE = 'SFS_PAYABLE',
  /** Labour-risk (SRL) and training levy (INFOTEP), employer-borne, owed to the TSS/INFOTEP. */
  INFOTEP_PAYABLE = 'INFOTEP_PAYABLE',
  /** Income tax (ISR) withheld from salaries, owed to the DGII. */
  PAYROLL_TAX_WITHHOLDING_PAYABLE = 'PAYROLL_TAX_WITHHOLDING_PAYABLE',
}
