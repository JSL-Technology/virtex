import {
  AccountCategory,
  AccountNature,
  AccountRole,
  AccountType,
} from '../../chart-of-accounts/enums/account-enums';
import { AccountTemplateDto } from '../entities/coa-template.entity';
import { findCountryProfile } from './country-profiles';
import { principalTaxName } from './country-tax-schemes';

/**
 * The chart of accounts a new tenant starts with, per country.
 *
 * Every market except the United States and Panama used to be provisioned with
 * `usGaapCoaTemplate` — a fifteen-account plan, in English, whose only tax account is
 * "Sales Tax Payable". A Dominican tenant opened its books to `1110 Cash and Cash Equivalents`
 * and had nowhere to post ITBIS. That is not a localisation gap, it is an unusable ledger.
 *
 * What this builds is an IFRS-structured plan in the market's own language, with the tax accounts
 * named after the country's actual consumption tax (ITBIS, IVA, IGV, ITBMS, ISV) and split into
 * the receivable and payable sides that a VAT return requires. IFRS is the reporting framework
 * adopted, in full or for listed entities, across every market in this list, which is why a single
 * structure is defensible where a single account-number scheme would not be.
 *
 * What this deliberately does NOT do is reproduce a country's statutory chart of accounts where
 * one is legally prescribed — Colombia's PUC (Decreto 2650), Peru's PCGE, Ecuador's and Bolivia's
 * plans. Those are published catalogues with thousands of coded accounts; approximating one from
 * memory would produce a plan that looks official and files incorrectly. `STATUTORY_PLAN_REQUIRED`
 * names them so the gap is visible in code and to the tenant, rather than hidden behind a chart
 * that appears complete.
 */
export const STATUTORY_PLAN_REQUIRED: Readonly<Record<string, string>> = {
  CO: 'Colombia exige el Plan Único de Cuentas (Decreto 2650). Importa el PUC oficial antes de reportar a la DIAN.',
  PE: 'Perú exige el Plan Contable General Empresarial (PCGE). Impórtalo antes de presentar información a SUNAT.',
  EC: 'Ecuador exige el catálogo de cuentas de la Superintendencia de Compañías para las sociedades sujetas a su control.',
  BO: 'Bolivia exige el plan de cuentas del SIN para la presentación de estados financieros.',
};

/**
 * The shape of an account CODE, per country — declared here, beside the codes themselves.
 *
 * `accounts` are addressed by an ordered list of segments (`AccountSegmentDefinition`), and
 * `ChartOfAccountsService.create` refuses any account whose segment count differs from the
 * organization's definition. Those two facts lived in two modules that never agreed: this file
 * emitted one segment per account while `AccountSegmentsService.initializeDefault` wrote a fixed
 * four-level structure into every organization, so the FIRST account of the FIRST tenant was
 * rejected — provisioning could not survive its own opening balance sheet.
 *
 * Declaring the structure next to the template makes the two impossible to separate: `group()`
 * and `leaf()` split their code through {@link splitCoaCode}, `OrganizationsService` initialises
 * the organization from {@link coaSegmentsFor}, and `coa-segments.spec.ts` asserts for every
 * supported country that every code the template emits fits the structure the same country
 * declares. A statutory plan added later — Colombia's PUC writes `1105.05`, Peru's PCGE `10.1` —
 * declares its own lengths here and the template follows automatically.
 */
export interface CoaSegmentSpec {
  name: string;
  length: number;
  isRequired: boolean;
}

/**
 * The IFRS starting plan below writes four-digit codes (`1000` → `1100` → `1110`), which is one
 * segment, not four. A code is a single addressable value here; the hierarchy is carried by
 * `parentId`, not by the code's punctuation.
 */
const DEFAULT_COA_SEGMENTS: readonly CoaSegmentSpec[] = Object.freeze([
  Object.freeze({ name: 'Cuenta', length: 4, isRequired: true }),
]);

/** Countries whose statutory plan uses a different code shape declare it here. */
const COA_SEGMENTS_BY_COUNTRY: Readonly<Record<string, readonly CoaSegmentSpec[]>> = {};

/** The account-code structure a country's chart of accounts is written in. */
export function coaSegmentsFor(countryCode: string): readonly CoaSegmentSpec[] {
  return COA_SEGMENTS_BY_COUNTRY[countryCode?.toUpperCase() ?? ''] ?? DEFAULT_COA_SEGMENTS;
}

/** Total number of characters a country's account code carries. */
export function coaCodeLength(countryCode: string): number {
  return coaSegmentsFor(countryCode).reduce((total, segment) => total + segment.length, 0);
}

/**
 * Split a template code into the segments the country's structure declares.
 *
 * Throws rather than truncating: a code that does not fit the structure is a defect in the
 * template, and the only thing worse than failing to provision is provisioning a chart whose
 * codes have been silently reshaped.
 */
export function splitCoaCode(countryCode: string, code: string): string[] {
  const specs = coaSegmentsFor(countryCode);
  const expected = coaCodeLength(countryCode);
  if (code.length !== expected) {
    throw new Error(
      `El código contable "${code}" no encaja en la estructura de ${countryCode} ` +
        `(${specs.map((s) => s.length).join('-')}, ${expected} caracteres).`,
    );
  }
  const segments: string[] = [];
  let offset = 0;
  for (const spec of specs) {
    segments.push(code.slice(offset, offset + spec.length));
    offset += spec.length;
  }
  return segments;
}

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

/** Spanish labels. Portuguese is handled separately for Brazil; English for the United States. */
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
  accrued: 'Gastos Acumulados por Pagar',
  payroll: 'Remuneraciones y Prestaciones por Pagar',
  serviceCharge: 'Propina Legal por Pagar',
  incomeTax: 'Impuesto sobre la Renta por Pagar',
  nonCurrentLiabilities: 'Pasivo No Corriente',
  longTermDebt: 'Deudas a Largo Plazo',
  equity: 'Patrimonio',
  capital: 'Capital Social',
  legalReserve: 'Reserva Legal',
  retained: 'Resultados Acumulados',
  periodResult: 'Resultado del Ejercicio',
  revenue: 'Ingresos',
  sales: 'Ingresos por Ventas',
  serviceRevenue: 'Ingresos por Servicios',
  discounts: 'Descuentos y Devoluciones sobre Ventas',
  otherIncome: 'Otros Ingresos',
  expenses: 'Gastos',
  cogs: 'Costo de Ventas',
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
  accrued: 'Despesas a Pagar',
  payroll: 'Obrigações Trabalhistas',
  serviceCharge: 'Gorjeta a Pagar',
  incomeTax: 'IRPJ e CSLL a Recolher',
  nonCurrentLiabilities: 'Passivo Não Circulante',
  longTermDebt: 'Empréstimos de Longo Prazo',
  equity: 'Patrimônio Líquido',
  capital: 'Capital Social',
  legalReserve: 'Reserva Legal',
  retained: 'Lucros ou Prejuízos Acumulados',
  periodResult: 'Resultado do Exercício',
  revenue: 'Receitas',
  sales: 'Receita de Vendas',
  serviceRevenue: 'Receita de Serviços',
  discounts: 'Descontos e Devoluções de Vendas',
  otherIncome: 'Outras Receitas',
  expenses: 'Despesas',
  cogs: 'Custo das Mercadorias Vendidas',
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
  accrued: 'Accrued Expenses',
  payroll: 'Payroll Liabilities',
  serviceCharge: 'Service Charge Payable',
  incomeTax: 'Income Tax Payable',
  nonCurrentLiabilities: 'Non-current Liabilities',
  longTermDebt: 'Long-term Debt',
  equity: 'Equity',
  capital: 'Common Stock',
  legalReserve: 'Additional Paid-in Capital',
  retained: 'Retained Earnings',
  periodResult: 'Current Period Earnings',
  revenue: 'Revenue',
  sales: 'Sales Revenue',
  serviceRevenue: 'Service Revenue',
  discounts: 'Sales Returns and Allowances',
  otherIncome: 'Other Income',
  expenses: 'Expenses',
  cogs: 'Cost of Goods Sold',
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

function labelsFor(countryCode: string): typeof ES {
  if (countryCode === 'BR') return PT;
  if (countryCode === 'US') return EN;
  return ES;
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
 * to exist as separate postable accounts, and both have to be named after the tax the country
 * actually levies. `principalTaxName` supplies that name from the same table the default taxes are
 * seeded from, so the ledger and the tax list cannot disagree.
 */
export function buildCountryCoaTemplate(countryCode: string): AccountTemplateDto[] {
  const code = countryCode?.toUpperCase() ?? '';
  const t = labelsFor(code);
  const tax = principalTaxName(code);
  const isEnglish = code === 'US';
  const isPortuguese = code === 'BR';

  const taxReceivable = isEnglish
    ? `${tax} Receivable`
    : isPortuguese
      ? `${tax} a Recuperar`
      : `${tax} por Cobrar (Crédito Fiscal)`;
  const taxPayable = isEnglish
    ? `${tax} Payable`
    : isPortuguese
      ? `${tax} a Recolher`
      : `${tax} por Pagar (Débito Fiscal)`;
  const withholdingReceivable = isEnglish
    ? 'Tax Withheld by Customers'
    : isPortuguese
      ? 'Tributos Retidos por Clientes'
      : 'Retenciones a Favor';
  const withholdingPayable = isEnglish
    ? 'Taxes Withheld from Vendors'
    : isPortuguese
      ? 'Tributos Retidos de Terceiros'
      : 'Retenciones por Pagar';

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
        leaf(code, { code: '2120', name: t.accrued }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2130', name: taxPayable, role: AccountRole.TAX_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2135', name: withholdingPayable, role: AccountRole.WITHHOLDING_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2140', name: t.payroll }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2150', name: t.incomeTax }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf(code, { code: '2160', name: t.serviceCharge, role: AccountRole.SERVICE_CHARGE_PAYABLE }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
      ]),
      group(code, '2200', t.nonCurrentLiabilities, AccountType.LIABILITY, AccountCategory.NON_CURRENT_LIABILITY, C, [
        leaf(code, { code: '2210', name: t.longTermDebt }, AccountType.LIABILITY, AccountCategory.NON_CURRENT_LIABILITY, C),
      ]),
    ]),

    group(code, '3000', t.equity, AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, C, [
      leaf(code, { code: '3100', name: t.capital }, AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, C),
      leaf(code, { code: '3200', name: t.legalReserve }, AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, C),
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
      leaf(code, { code: '5200', name: t.salaries }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
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
export function requiresStatutoryPlanImport(countryCode: string): boolean {
  return Boolean(STATUTORY_PLAN_REQUIRED[countryCode?.toUpperCase() ?? '']);
}

/** Guard used by the seeder: a country with no profile has no chart of accounts. */
export function hasCoaTemplate(countryCode: string): boolean {
  return Boolean(findCountryProfile(countryCode));
}
