import {
  AccountCategory,
  AccountNature,
  AccountRole,
  AccountType,
} from '../../chart-of-accounts/enums/account-enums';
import { AccountTemplateDto } from '../entities/coa-template.entity';
import { BooksLanguage, PayrollAccountNames, marketFor, splitCoaCode } from '../../markets';

/**
 * The chart of accounts a new tenant starts with — the same engine for every market.
 *
 * Every market except the United States and Panama used to be provisioned with
 * `usGaapCoaTemplate` — a fifteen-account plan, in English, whose only tax account is
 * "Sales Tax Payable". A Dominican tenant opened its books to `1110 Cash and Cash Equivalents`
 * and had nowhere to post ITBIS. That is not a localisation gap, it is an unusable ledger.
 *
 * What this builds is an IFRS-structured plan in the market's books language, with the tax accounts
 * named after the market's actual consumption tax and split into the receivable and payable sides
 * that a VAT return requires. IFRS is the reporting framework adopted, in full or for listed
 * entities, across every market the product is sold in, which is why a single structure is
 * defensible where a single account-number scheme would not be.
 *
 * What a market adds to the plan is the market's own declaration (`markets/<cc>/accounting.ts`):
 * the institutions its payroll is remitted to, its excise tax, its legal service charge, the
 * authority's grouping codes, and the official plan its law prescribes where this template does
 * not reproduce it. This file names no market.
 */
export {
  COUNTRY_SPECIFIC_COA_TERMS,
  STATUTORY_PLAN_REQUIRED,
  coaCodeLength,
  coaSegmentsFor,
  hasCoaTemplate,
  requiresStatutoryPlanImport,
  splitCoaCode,
  type CoaSegmentSpec,
} from '../../markets';

/**
 * The balance a type normally carries. An account whose nature differs from this is a CONTRA
 * account, and must say so — `ChartOfAccountsService` refuses the mismatch otherwise, which is
 * how the opening chart's accumulated depreciation, allowance for doubtful accounts and sales
 * returns used to abort provisioning on the second account they reached.
 *
 * Derived here rather than hand-flagged at each call site, so a future template account with an
 * opposite balance is marked automatically instead of failing at run time.
 */
function normalNatureFor(type: AccountType): AccountNature {
  return type === AccountType.ASSET || type === AccountType.EXPENSE
    ? AccountNature.DEBIT
    : AccountNature.CREDIT;
}

interface Leaf {
  code: string;
  name: string;
  nature?: AccountNature;
  /** Operational role, so automatic postings can find the account without matching its name. */
  role?: AccountRole;
}

/** Payroll account names where the market names no institution of its own. */
const NEUTRAL_PAYROLL: Readonly<Record<BooksLanguage, PayrollAccountNames>> = {
  es: {
    pension: 'Aportes de Pensión por Pagar',
    health: 'Aportes de Salud por Pagar',
    otherContributions: 'Otros Aportes Laborales por Pagar',
    incomeTaxWithheld: 'Impuesto sobre la Renta Retenido a Empleados por Pagar',
    employerContributions: 'Aportes Patronales a la Seguridad Social',
  },
  pt: {
    pension: 'Previdência a Recolher',
    health: 'Plano de Saúde a Recolher',
    otherContributions: 'Outros Encargos Trabalhistas a Recolher',
    incomeTaxWithheld: 'IRRF a Recolher',
    employerContributions: 'Encargos Sociais (Empregador)',
  },
  en: {
    pension: 'Pension Contributions Payable',
    health: 'Health Contributions Payable',
    otherContributions: 'Other Payroll Contributions Payable',
    incomeTaxWithheld: 'Payroll Income Tax Withheld',
    employerContributions: 'Employer Payroll Contributions',
  },
};

/** The plan's names in each books language. A market's own institutions are its declaration's. */
const ES = {
  assets: 'Activo',
  currentAssets: 'Activo Corriente',
  cash: 'Efectivo y Equivalentes de Efectivo',
  banks: 'Bancos',
  receivables: 'Cuentas por Cobrar Comerciales',
  allowance: 'Estimación para Cuentas Incobrables',
  inventory: 'Inventarios',
  prepaid: 'Gastos Pagados por Anticipado',
  nonCurrentAssets: 'Activo No Corriente',
  ppe: 'Propiedad, Planta y Equipo',
  depreciation: 'Depreciación Acumulada',
  intangibles: 'Activos Intangibles',
  liabilities: 'Pasivo',
  currentLiabilities: 'Pasivo Corriente',
  payables: 'Cuentas por Pagar Comerciales',
  goodsReceivedNotInvoiced: 'Mercancía Recibida No Facturada',
  accrued: 'Gastos Acumulados por Pagar',
  payroll: 'Remuneraciones y Prestaciones por Pagar',
  serviceCharge: 'Cargos por Servicio por Pagar',
  exciseTax: 'Impuestos Específicos al Consumo por Pagar',
  incomeTax: 'Impuesto sobre la Renta por Pagar',
  customerAdvances: 'Anticipos de Clientes',
  nonCurrentLiabilities: 'Pasivo No Corriente',
  longTermDebt: 'Deudas a Largo Plazo',
  equity: 'Patrimonio',
  capital: 'Capital Social',
  legalReserve: 'Reserva Legal',
  openingBalance: 'Patrimonio por Saldos Iniciales',
  retained: 'Resultados Acumulados',
  periodResult: 'Resultado del Ejercicio',
  revenue: 'Ingresos',
  sales: 'Ingresos por Ventas',
  serviceRevenue: 'Ingresos por Servicios',
  discounts: 'Descuentos y Devoluciones sobre Ventas',
  otherIncome: 'Otros Ingresos',
  expenses: 'Gastos',
  cogs: 'Costo de Ventas',
  inventoryAdjustment: 'Ajustes de Inventario',
  salaries: 'Sueldos y Salarios',
  rent: 'Alquileres',
  utilities: 'Servicios Públicos',
  depreciationExpense: 'Gasto por Depreciación',
  professional: 'Honorarios Profesionales',
  financial: 'Gastos Financieros',
  forex: 'Diferencia Cambiaria',
  inflation: 'Resultado por Exposición a la Inflación',
  otherExpenses: 'Otros Gastos',
};

const PT: typeof ES = {
  assets: 'Ativo',
  currentAssets: 'Ativo Circulante',
  cash: 'Caixa e Equivalentes de Caixa',
  banks: 'Bancos',
  receivables: 'Contas a Receber de Clientes',
  allowance: 'Provisão para Créditos de Liquidação Duvidosa',
  inventory: 'Estoques',
  prepaid: 'Despesas Antecipadas',
  nonCurrentAssets: 'Ativo Não Circulante',
  ppe: 'Imobilizado',
  depreciation: 'Depreciação Acumulada',
  intangibles: 'Intangível',
  liabilities: 'Passivo',
  currentLiabilities: 'Passivo Circulante',
  payables: 'Fornecedores',
  goodsReceivedNotInvoiced: 'Mercadorias Recebidas Não Faturadas',
  accrued: 'Despesas a Pagar',
  payroll: 'Obrigações Trabalhistas',
  serviceCharge: 'Gorjeta a Pagar',
  exciseTax: 'Impostos Seletivos a Recolher',
  incomeTax: 'IRPJ e CSLL a Recolher',
  customerAdvances: 'Adiantamentos de Clientes',
  nonCurrentLiabilities: 'Passivo Não Circulante',
  longTermDebt: 'Empréstimos de Longo Prazo',
  equity: 'Patrimônio Líquido',
  capital: 'Capital Social',
  legalReserve: 'Reserva Legal',
  openingBalance: 'Património de Saldos Iniciais',
  retained: 'Lucros ou Prejuízos Acumulados',
  periodResult: 'Resultado do Exercício',
  revenue: 'Receitas',
  sales: 'Receita de Vendas',
  serviceRevenue: 'Receita de Serviços',
  discounts: 'Descontos e Devoluções de Vendas',
  otherIncome: 'Outras Receitas',
  expenses: 'Despesas',
  cogs: 'Custo das Mercadorias Vendidas',
  inventoryAdjustment: 'Ajustes de Estoque',
  salaries: 'Salários e Ordenados',
  rent: 'Aluguéis',
  utilities: 'Serviços Públicos',
  depreciationExpense: 'Despesa de Depreciação',
  professional: 'Honorários Profissionais',
  financial: 'Despesas Financeiras',
  forex: 'Variação Cambial',
  inflation: 'Resultado da Exposição à Inflação',
  otherExpenses: 'Outras Despesas',
};

const EN: typeof ES = {
  assets: 'Assets',
  currentAssets: 'Current Assets',
  cash: 'Cash and Cash Equivalents',
  banks: 'Bank Accounts',
  receivables: 'Accounts Receivable',
  allowance: 'Allowance for Doubtful Accounts',
  inventory: 'Inventory',
  prepaid: 'Prepaid Expenses',
  nonCurrentAssets: 'Non-current Assets',
  ppe: 'Property, Plant and Equipment',
  depreciation: 'Accumulated Depreciation',
  intangibles: 'Intangible Assets',
  liabilities: 'Liabilities',
  currentLiabilities: 'Current Liabilities',
  payables: 'Accounts Payable',
  goodsReceivedNotInvoiced: 'Goods Received Not Invoiced',
  accrued: 'Accrued Expenses',
  payroll: 'Payroll Liabilities',
  serviceCharge: 'Service Charge Payable',
  exciseTax: 'Excise Tax Payable',
  incomeTax: 'Income Tax Payable',
  customerAdvances: 'Customer Advances',
  nonCurrentLiabilities: 'Non-current Liabilities',
  longTermDebt: 'Long-term Debt',
  equity: 'Equity',
  capital: 'Common Stock',
  legalReserve: 'Additional Paid-in Capital',
  openingBalance: 'Opening Balance Equity',
  retained: 'Retained Earnings',
  periodResult: 'Current Period Earnings',
  revenue: 'Revenue',
  sales: 'Sales Revenue',
  serviceRevenue: 'Service Revenue',
  discounts: 'Sales Returns and Allowances',
  otherIncome: 'Other Income',
  expenses: 'Expenses',
  cogs: 'Cost of Goods Sold',
  inventoryAdjustment: 'Inventory Adjustments',
  salaries: 'Salaries and Wages',
  rent: 'Rent Expense',
  utilities: 'Utilities',
  depreciationExpense: 'Depreciation Expense',
  professional: 'Professional Fees',
  financial: 'Interest and Bank Charges',
  forex: 'Foreign Exchange Gain or Loss',
  inflation: 'Inflation Adjustment Result',
  otherExpenses: 'Other Expenses',
};


const LABELS: Readonly<Record<BooksLanguage, typeof ES>> = { es: ES, pt: PT, en: EN };

/**
 * The language the market's books are kept in. A market the product is not sold in has no books
 * language; the plan is then written in the product's default language, Spanish.
 */
function booksLanguageOf(countryCode: string): BooksLanguage {
  return marketFor(countryCode).profile?.booksLanguage ?? 'es';
}

function groupingCode(countryCode: string, code: string): { fiscalGroupingCode?: string } {
  const value = marketFor(countryCode).accounting.fiscalGroupingCodes?.[code];
  return value ? { fiscalGroupingCode: value } : {};
}

function group(
  countryCode: string,
  code: string,
  name: string,
  type: AccountType,
  category: AccountCategory,
  nature: AccountNature,
  children: AccountTemplateDto[],
): AccountTemplateDto {
  return {
    segments: splitCoaCode(countryCode, code),
    ...groupingCode(countryCode, code),
    name,
    type,
    category,
    nature,
    isContraAccount: nature !== normalNatureFor(type),
    isPostable: false,
    children,
  };
}

function leaf(
  countryCode: string,
  { code, name, nature, role }: Leaf,
  type: AccountType,
  category: AccountCategory,
  defaultNature: AccountNature,
): AccountTemplateDto {
  const resolvedNature = nature ?? defaultNature;
  return {
    segments: splitCoaCode(countryCode, code),
    ...groupingCode(countryCode, code),
    name,
    type,
    category,
    nature: resolvedNature,
    isContraAccount: resolvedNature !== normalNatureFor(type),
    isPostable: true,
    systemRole: role,
  };
}


/**
 * Build the starting chart of accounts for a country.
 *
 * The tax accounts are the reason this is a function and not a constant: a VAT return is prepared
 * from the difference between tax charged on sales and tax paid on purchases, so both sides have
 * to exist as separate postable accounts, and both have to be named after the tax the market
 * actually levies. The market's `principalTaxName` supplies that name from the same declaration
 * its default taxes are seeded from, so the ledger and the tax list cannot disagree.
 */
export function buildCountryCoaTemplate(countryCode: string): AccountTemplateDto[] {
  const code = countryCode?.toUpperCase() ?? '';
  const market = marketFor(code);
  const language = booksLanguageOf(code);
  const t = LABELS[language];
  const tax = market.taxes.principalTaxName;

  const TAX_ACCOUNTS: Readonly<Record<BooksLanguage, { receivable: string; payable: string; withheldByCustomers: string; withheldFromVendors: string }>> = {
    en: {
      receivable: `${tax} Receivable`,
      payable: `${tax} Payable`,
      withheldByCustomers: 'Tax Withheld by Customers',
      withheldFromVendors: 'Taxes Withheld from Vendors',
    },
    pt: {
      receivable: `${tax} a Recuperar`,
      payable: `${tax} a Recolher`,
      withheldByCustomers: 'Tributos Retidos por Clientes',
      withheldFromVendors: 'Tributos Retidos de Terceiros',
    },
    es: {
      receivable: `${tax} por Cobrar (Crédito Fiscal)`,
      payable: `${tax} por Pagar (Débito Fiscal)`,
      withheldByCustomers: 'Retenciones a Favor',
      withheldFromVendors: 'Retenciones por Pagar',
    },
  };
  const taxAccounts = TAX_ACCOUNTS[language];
  const taxReceivable = taxAccounts.receivable;
  const taxPayable = taxAccounts.payable;
  const withholdingReceivable = taxAccounts.withheldByCustomers;
  const withholdingPayable = taxAccounts.withheldFromVendors;

  const accounting = market.accounting;
  const payroll: PayrollAccountNames = {
    ...NEUTRAL_PAYROLL[language],
    ...(accounting.payrollAccounts ?? {}),
  };
  const exciseTaxName = accounting.exciseTaxAccount ?? t.exciseTax;
  // Only a market whose taxes declare a legal service charge gets the account; the rate and the
  // account come from the same market, so they cannot disagree.
  const serviceChargeName = market.taxes.serviceChargeRate > 0 ? (accounting.serviceChargeAccount ?? t.serviceCharge) : null;

  const D = AccountNature.DEBIT;
  const C = AccountNature.CREDIT;

  return [
    group(code, '1000', t.assets, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D, [
      group(code, '1100', t.currentAssets, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D, [
        leaf(code, { code: '1110', name: t.cash, role: AccountRole.CASH }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf(code, { code: '1120', name: t.banks, role: AccountRole.BANK }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf(code, { code: '1130', name: t.receivables, role: AccountRole.ACCOUNTS_RECEIVABLE }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf(code, { code: '1135', name: t.allowance, nature: C, role: AccountRole.DOUBTFUL_ALLOWANCE }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, C),
        leaf(code, { code: '1140', name: t.inventory, role: AccountRole.INVENTORY }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf(code, { code: '1150', name: taxReceivable, role: AccountRole.TAX_RECEIVABLE }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf(code, { code: '1155', name: withholdingReceivable, role: AccountRole.WITHHOLDING_RECEIVABLE }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf(code, { code: '1160', name: t.prepaid }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
      ]),
      group(code, '1200', t.nonCurrentAssets, AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, D, [
        leaf(code, { code: '1210', name: t.ppe }, AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, D),
        leaf(code, { code: '1220', name: t.depreciation, nature: C, role: AccountRole.ACCUMULATED_DEPRECIATION }, AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, C),
        leaf(code, { code: '1230', name: t.intangibles }, AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, D),
      ]),
    ]),

    group(code, '2000', t.liabilities, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C, [
      group(code, '2100', t.currentLiabilities, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C, [
        leaf(code, { code: '2110', name: t.payables, role: AccountRole.ACCOUNTS_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        // The bridge between a goods receipt and the supplier's invoice (QA C-07): the receipt
        // credits it when stock arrives, the invoice debits it when the goods are billed. Its
        // balance is, at any moment, what has been received and not yet invoiced.
        leaf(code, { code: '2115', name: t.goodsReceivedNotInvoiced, role: AccountRole.GOODS_RECEIVED_NOT_INVOICED }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2120', name: t.accrued }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2130', name: taxPayable, role: AccountRole.TAX_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2135', name: withholdingPayable, role: AccountRole.WITHHOLDING_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2140', name: t.payroll, role: AccountRole.PAYROLL_NET_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2141', name: payroll.pension, role: AccountRole.PENSION_CONTRIBUTIONS_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2142', name: payroll.health, role: AccountRole.HEALTH_CONTRIBUTIONS_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2143', name: payroll.otherContributions, role: AccountRole.OTHER_PAYROLL_CONTRIBUTIONS_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2144', name: payroll.incomeTaxWithheld, role: AccountRole.PAYROLL_TAX_WITHHOLDING_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2150', name: t.incomeTax }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        ...(serviceChargeName
          ? [leaf(code, { code: '2160', name: serviceChargeName, role: AccountRole.SERVICE_CHARGE_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C)]
          : []),
        // Excise (ISC / IEPS / ICE / INC, named by the pack) is a liability of its own, declared separately from the
        // consumption tax. Netting it into 2130 makes the tax return unfileable.
        leaf(code, { code: '2165', name: exciseTaxName, role: AccountRole.EXCISE_TAX_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        // Money held for a customer before any document consumes it. A liability, never a
        // negative receivable — see `AccountRole.CUSTOMER_ADVANCES`.
        leaf(code, { code: '2170', name: t.customerAdvances, role: AccountRole.CUSTOMER_ADVANCES }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
      ]),
      group(code, '2200', t.nonCurrentLiabilities, AccountType.LIABILITY, AccountCategory.NON_CURRENT_LIABILITY, C, [
        leaf(code, { code: '2210', name: t.longTermDebt }, AccountType.LIABILITY, AccountCategory.NON_CURRENT_LIABILITY, C),
      ]),
    ]),

    group(code, '3000', t.equity, AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, C, [
      leaf(code, { code: '3100', name: t.capital }, AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, C),
      leaf(code, { code: '3200', name: t.legalReserve }, AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, C),
      // The counterpart of every balance that predates the books: opening stock, an opening bank
      // balance, a carried-over receivable. Kept out of retained earnings on purpose.
      leaf(code, { code: '3150', name: t.openingBalance, role: AccountRole.OPENING_BALANCE_EQUITY }, AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, C),
      leaf(code, { code: '3300', name: t.retained, role: AccountRole.RETAINED_EARNINGS }, AccountType.EQUITY, AccountCategory.RETAINED_EARNINGS, C),
      leaf(code, { code: '3400', name: t.periodResult }, AccountType.EQUITY, AccountCategory.RETAINED_EARNINGS, C),
    ]),

    group(code, '4000', t.revenue, AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, C, [
      leaf(code, { code: '4100', name: t.sales, role: AccountRole.SALES_REVENUE }, AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, C),
      leaf(code, { code: '4200', name: t.serviceRevenue, role: AccountRole.SERVICE_REVENUE }, AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, C),
      leaf(code, { code: '4300', name: t.discounts, nature: D, role: AccountRole.SALES_DISCOUNTS }, AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, D),
      leaf(code, { code: '4900', name: t.otherIncome }, AccountType.REVENUE, AccountCategory.NON_OPERATING_REVENUE, C),
    ]),

    group(code, '5000', t.expenses, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D, [
      leaf(code, { code: '5100', name: t.cogs, role: AccountRole.COST_OF_GOODS_SOLD }, AccountType.EXPENSE, AccountCategory.COST_OF_GOODS_SOLD, D),
      // Shrinkage, breakage and count corrections. Deliberately not 5100: a loss is not a cost of
      // what was sold, and an inventory figure that moves with no counterpart is not a figure.
      leaf(code, { code: '5150', name: t.inventoryAdjustment, role: AccountRole.INVENTORY_ADJUSTMENT }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf(code, { code: '5200', name: t.salaries, role: AccountRole.SALARY_EXPENSE }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf(code, { code: '5250', name: payroll.employerContributions, role: AccountRole.EMPLOYER_CONTRIBUTIONS_EXPENSE }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf(code, { code: '5300', name: t.rent }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf(code, { code: '5400', name: t.utilities }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf(code, { code: '5500', name: t.depreciationExpense, role: AccountRole.DEPRECIATION_EXPENSE }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf(code, { code: '5600', name: t.professional }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf(code, { code: '5700', name: t.financial }, AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, D),
      leaf(code, { code: '5750', name: t.forex, role: AccountRole.FOREX_GAIN_LOSS }, AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, D),
      leaf(code, { code: '5760', name: t.inflation, role: AccountRole.INFLATION_ADJUSTMENT }, AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, D),
      leaf(code, { code: '5900', name: t.otherExpenses }, AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, D),
    ]),
  ];
}

/** True when the country is one whose statutory plan this template does not reproduce. */
