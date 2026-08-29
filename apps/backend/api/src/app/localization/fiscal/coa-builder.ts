import {
  AccountCategory,
  AccountNature,
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

interface Leaf {
  code: string;
  name: string;
  nature?: AccountNature;
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
  otherExpenses: 'Other Expenses',
};

function labelsFor(countryCode: string): typeof ES {
  if (countryCode === 'BR') return PT;
  if (countryCode === 'US') return EN;
  return ES;
}

function group(
  code: string,
  name: string,
  type: AccountType,
  category: AccountCategory,
  nature: AccountNature,
  children: AccountTemplateDto[],
): AccountTemplateDto {
  return { segments: [code], name, type, category, nature, isPostable: false, children };
}

function leaf(
  { code, name, nature }: Leaf,
  type: AccountType,
  category: AccountCategory,
  defaultNature: AccountNature,
): AccountTemplateDto {
  return {
    segments: [code],
    name,
    type,
    category,
    nature: nature ?? defaultNature,
    isPostable: true,
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
    group('1000', t.assets, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D, [
      group('1100', t.currentAssets, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D, [
        leaf({ code: '1110', name: t.cash }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf({ code: '1120', name: t.banks }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf({ code: '1130', name: t.receivables }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf({ code: '1135', name: t.allowance, nature: C }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, C),
        leaf({ code: '1140', name: t.inventory }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf({ code: '1150', name: taxReceivable }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf({ code: '1155', name: withholdingReceivable }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
        leaf({ code: '1160', name: t.prepaid }, AccountType.ASSET, AccountCategory.CURRENT_ASSET, D),
      ]),
      group('1200', t.nonCurrentAssets, AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, D, [
        leaf({ code: '1210', name: t.ppe }, AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, D),
        leaf({ code: '1220', name: t.depreciation, nature: C }, AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, C),
        leaf({ code: '1230', name: t.intangibles }, AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, D),
      ]),
    ]),

    group('2000', t.liabilities, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C, [
      group('2100', t.currentLiabilities, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C, [
        leaf({ code: '2110', name: t.payables }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf({ code: '2120', name: t.accrued }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf({ code: '2130', name: taxPayable }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf({ code: '2135', name: withholdingPayable }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf({ code: '2140', name: t.payroll }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
        leaf({ code: '2150', name: t.incomeTax }, AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, C),
      ]),
      group('2200', t.nonCurrentLiabilities, AccountType.LIABILITY, AccountCategory.NON_CURRENT_LIABILITY, C, [
        leaf({ code: '2210', name: t.longTermDebt }, AccountType.LIABILITY, AccountCategory.NON_CURRENT_LIABILITY, C),
      ]),
    ]),

    group('3000', t.equity, AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, C, [
      leaf({ code: '3100', name: t.capital }, AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, C),
      leaf({ code: '3200', name: t.legalReserve }, AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, C),
      leaf({ code: '3300', name: t.retained }, AccountType.EQUITY, AccountCategory.RETAINED_EARNINGS, C),
      leaf({ code: '3400', name: t.periodResult }, AccountType.EQUITY, AccountCategory.RETAINED_EARNINGS, C),
    ]),

    group('4000', t.revenue, AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, C, [
      leaf({ code: '4100', name: t.sales }, AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, C),
      leaf({ code: '4200', name: t.serviceRevenue }, AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, C),
      leaf({ code: '4300', name: t.discounts, nature: D }, AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, D),
      leaf({ code: '4900', name: t.otherIncome }, AccountType.REVENUE, AccountCategory.NON_OPERATING_REVENUE, C),
    ]),

    group('5000', t.expenses, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D, [
      leaf({ code: '5100', name: t.cogs }, AccountType.EXPENSE, AccountCategory.COST_OF_GOODS_SOLD, D),
      leaf({ code: '5200', name: t.salaries }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf({ code: '5300', name: t.rent }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf({ code: '5400', name: t.utilities }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf({ code: '5500', name: t.depreciationExpense }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf({ code: '5600', name: t.professional }, AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, D),
      leaf({ code: '5700', name: t.financial }, AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, D),
      leaf({ code: '5900', name: t.otherExpenses }, AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, D),
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
