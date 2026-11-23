import { MigrationInterface, QueryRunner } from 'typeorm';

/** One account of an opening plan: its books language, code, books name, and its other names. */
type PlanName = readonly [books: string, code: string, booksName: string, translations: Readonly<Record<string, string>>];

/**
 * The chart's names in every language the product speaks, for the companies already provisioned.
 *
 * Every account was stored in the books language only (`{ "es": "Bancos" }`): a US controller of a
 * Dominican company read the interface in English and the whole chart in Spanish, though the plan
 * the company was opened with has its names in English and Portuguese too. New companies get them
 * from the plan itself (`buildCountryCoaTemplate` → `translations`); this gives them to the rest.
 *
 * Only where the name is still the one the plan opened the company with — by code and by the
 * books-language text — and only for the languages it does not have: a name a person wrote, or a
 * translation a person entered, is theirs and is not touched. The books language is never changed.
 *
 * `PLAN_NAMES` is a literal snapshot of the opening plans of every market when this was written,
 * one row per account name (the same account reads the same in every market that names it so). A
 * migration does not read the application's code: what it changes must not move when that code does.
 */
export class AccountNameTranslations1789810000000 implements MigrationInterface {
  name = 'AccountNameTranslations1789810000000';

  private static readonly PLAN_NAMES: readonly PlanName[] = [
    ["en", "1000", "Assets", {"es": "Activo", "pt": "Ativo"}],
    ["en", "1100", "Current Assets", {"es": "Activo Corriente", "pt": "Ativo Circulante"}],
    ["en", "1110", "Cash and Cash Equivalents", {"es": "Efectivo y Equivalentes de Efectivo", "pt": "Caixa e Equivalentes de Caixa"}],
    ["en", "1120", "Bank Accounts", {"es": "Bancos", "pt": "Bancos"}],
    ["en", "1130", "Accounts Receivable", {"es": "Cuentas por Cobrar Comerciales", "pt": "Contas a Receber de Clientes"}],
    ["en", "1135", "Allowance for Doubtful Accounts", {"es": "Estimación para Cuentas Incobrables", "pt": "Provisão para Créditos de Liquidação Duvidosa"}],
    ["en", "1140", "Inventory", {"es": "Inventarios", "pt": "Estoques"}],
    ["en", "1150", "Sales Tax Receivable", {"es": "Sales Tax por Cobrar (Crédito Fiscal)", "pt": "Sales Tax a Recuperar"}],
    ["en", "1155", "Tax Withheld by Customers", {"es": "Retenciones a Favor", "pt": "Tributos Retidos por Clientes"}],
    ["en", "1160", "Prepaid Expenses", {"es": "Gastos Pagados por Anticipado", "pt": "Despesas Antecipadas"}],
    ["en", "1200", "Non-current Assets", {"es": "Activo No Corriente", "pt": "Ativo Não Circulante"}],
    ["en", "1210", "Property, Plant and Equipment", {"es": "Propiedad, Planta y Equipo", "pt": "Imobilizado"}],
    ["en", "1220", "Accumulated Depreciation", {"es": "Depreciación Acumulada", "pt": "Depreciação Acumulada"}],
    ["en", "1230", "Intangible Assets", {"es": "Activos Intangibles", "pt": "Intangível"}],
    ["en", "2000", "Liabilities", {"es": "Pasivo", "pt": "Passivo"}],
    ["en", "2100", "Current Liabilities", {"es": "Pasivo Corriente", "pt": "Passivo Circulante"}],
    ["en", "2110", "Accounts Payable", {"es": "Cuentas por Pagar Comerciales", "pt": "Fornecedores"}],
    ["en", "2115", "Goods Received Not Invoiced", {"es": "Mercancía Recibida No Facturada", "pt": "Mercadorias Recebidas Não Faturadas"}],
    ["en", "2120", "Accrued Expenses", {"es": "Gastos Acumulados por Pagar", "pt": "Despesas a Pagar"}],
    ["en", "2130", "Sales Tax Payable", {"es": "Sales Tax por Pagar (Débito Fiscal)", "pt": "Sales Tax a Recolher"}],
    ["en", "2135", "Taxes Withheld from Vendors", {"es": "Retenciones por Pagar", "pt": "Tributos Retidos de Terceiros"}],
    ["en", "2140", "Payroll Liabilities", {"es": "Remuneraciones y Prestaciones por Pagar", "pt": "Obrigações Trabalhistas"}],
    ["en", "2141", "Pension Contributions Payable", {"es": "Aportes de Pensión por Pagar", "pt": "Previdência a Recolher"}],
    ["en", "2142", "Health Contributions Payable", {"es": "Aportes de Salud por Pagar", "pt": "Plano de Saúde a Recolher"}],
    ["en", "2143", "Other Payroll Contributions Payable", {"es": "Otros Aportes Laborales por Pagar", "pt": "Outros Encargos Trabalhistas a Recolher"}],
    ["en", "2144", "Payroll Income Tax Withheld", {"es": "Impuesto sobre la Renta Retenido a Empleados por Pagar", "pt": "IRRF a Recolher"}],
    ["en", "2150", "Income Tax Payable", {"es": "Impuesto sobre la Renta por Pagar", "pt": "IRPJ e CSLL a Recolher"}],
    ["en", "2165", "Excise Tax Payable", {"es": "Impuestos Específicos al Consumo por Pagar", "pt": "Impostos Seletivos a Recolher"}],
    ["en", "2170", "Customer Advances", {"es": "Anticipos de Clientes", "pt": "Adiantamentos de Clientes"}],
    ["en", "2200", "Non-current Liabilities", {"es": "Pasivo No Corriente", "pt": "Passivo Não Circulante"}],
    ["en", "2210", "Long-term Debt", {"es": "Deudas a Largo Plazo", "pt": "Empréstimos de Longo Prazo"}],
    ["en", "3000", "Equity", {"es": "Patrimonio", "pt": "Patrimônio Líquido"}],
    ["en", "3100", "Common Stock", {"es": "Capital Social", "pt": "Capital Social"}],
    ["en", "3150", "Opening Balance Equity", {"es": "Patrimonio por Saldos Iniciales", "pt": "Património de Saldos Iniciais"}],
    ["en", "3200", "Additional Paid-in Capital", {"es": "Reserva Legal", "pt": "Reserva Legal"}],
    ["en", "3300", "Retained Earnings", {"es": "Resultados Acumulados", "pt": "Lucros ou Prejuízos Acumulados"}],
    ["en", "3400", "Current Period Earnings", {"es": "Resultado del Ejercicio", "pt": "Resultado do Exercício"}],
    ["en", "4000", "Revenue", {"es": "Ingresos", "pt": "Receitas"}],
    ["en", "4100", "Sales Revenue", {"es": "Ingresos por Ventas", "pt": "Receita de Vendas"}],
    ["en", "4200", "Service Revenue", {"es": "Ingresos por Servicios", "pt": "Receita de Serviços"}],
    ["en", "4300", "Sales Returns and Allowances", {"es": "Descuentos y Devoluciones sobre Ventas", "pt": "Descontos e Devoluções de Vendas"}],
    ["en", "4900", "Other Income", {"es": "Otros Ingresos", "pt": "Outras Receitas"}],
    ["en", "5000", "Expenses", {"es": "Gastos", "pt": "Despesas"}],
    ["en", "5100", "Cost of Goods Sold", {"es": "Costo de Ventas", "pt": "Custo das Mercadorias Vendidas"}],
    ["en", "5150", "Inventory Adjustments", {"es": "Ajustes de Inventario", "pt": "Ajustes de Estoque"}],
    ["en", "5200", "Salaries and Wages", {"es": "Sueldos y Salarios", "pt": "Salários e Ordenados"}],
    ["en", "5250", "Employer Payroll Contributions", {"es": "Aportes Patronales a la Seguridad Social", "pt": "Encargos Sociais (Empregador)"}],
    ["en", "5300", "Rent Expense", {"es": "Alquileres", "pt": "Aluguéis"}],
    ["en", "5400", "Utilities", {"es": "Servicios Públicos", "pt": "Serviços Públicos"}],
    ["en", "5500", "Depreciation Expense", {"es": "Gasto por Depreciación", "pt": "Despesa de Depreciação"}],
    ["en", "5600", "Professional Fees", {"es": "Honorarios Profesionales", "pt": "Honorários Profissionais"}],
    ["en", "5700", "Interest and Bank Charges", {"es": "Gastos Financieros", "pt": "Despesas Financeiras"}],
    ["en", "5750", "Realized Foreign Exchange Gain or Loss", {"es": "Diferencia Cambiaria Realizada", "pt": "Variação Cambial Realizada"}],
    ["en", "5755", "Unrealized Foreign Exchange Gain or Loss", {"es": "Diferencia Cambiaria No Realizada", "pt": "Variação Cambial Não Realizada"}],
    ["en", "5760", "Inflation Adjustment Result", {"es": "Resultado por Exposición a la Inflación", "pt": "Resultado da Exposição à Inflação"}],
    ["en", "5900", "Other Expenses", {"es": "Otros Gastos", "pt": "Outras Despesas"}],
    ["es", "1000", "Activo", {"en": "Assets", "pt": "Ativo"}],
    ["es", "1100", "Activo Corriente", {"en": "Current Assets", "pt": "Ativo Circulante"}],
    ["es", "1110", "Efectivo y Equivalentes de Efectivo", {"en": "Cash and Cash Equivalents", "pt": "Caixa e Equivalentes de Caixa"}],
    ["es", "1120", "Bancos", {"en": "Bank Accounts", "pt": "Bancos"}],
    ["es", "1130", "Cuentas por Cobrar Comerciales", {"en": "Accounts Receivable", "pt": "Contas a Receber de Clientes"}],
    ["es", "1135", "Estimación para Cuentas Incobrables", {"en": "Allowance for Doubtful Accounts", "pt": "Provisão para Créditos de Liquidação Duvidosa"}],
    ["es", "1140", "Inventarios", {"en": "Inventory", "pt": "Estoques"}],
    ["es", "1150", "IGV por Cobrar (Crédito Fiscal)", {"en": "IGV Receivable", "pt": "IGV a Recuperar"}],
    ["es", "1150", "ISV por Cobrar (Crédito Fiscal)", {"en": "ISV Receivable", "pt": "ISV a Recuperar"}],
    ["es", "1150", "ITBIS por Cobrar (Crédito Fiscal)", {"en": "ITBIS Receivable", "pt": "ITBIS a Recuperar"}],
    ["es", "1150", "ITBMS por Cobrar (Crédito Fiscal)", {"en": "ITBMS Receivable", "pt": "ITBMS a Recuperar"}],
    ["es", "1150", "IVA Básico por Cobrar (Crédito Fiscal)", {"en": "IVA Básico Receivable", "pt": "IVA Básico a Recuperar"}],
    ["es", "1150", "IVA por Cobrar (Crédito Fiscal)", {"en": "IVA Receivable", "pt": "IVA a Recuperar"}],
    ["es", "1155", "Retenciones a Favor", {"en": "Tax Withheld by Customers", "pt": "Tributos Retidos por Clientes"}],
    ["es", "1160", "Gastos Pagados por Anticipado", {"en": "Prepaid Expenses", "pt": "Despesas Antecipadas"}],
    ["es", "1200", "Activo No Corriente", {"en": "Non-current Assets", "pt": "Ativo Não Circulante"}],
    ["es", "1210", "Propiedad, Planta y Equipo", {"en": "Property, Plant and Equipment", "pt": "Imobilizado"}],
    ["es", "1220", "Depreciación Acumulada", {"en": "Accumulated Depreciation", "pt": "Depreciação Acumulada"}],
    ["es", "1230", "Activos Intangibles", {"en": "Intangible Assets", "pt": "Intangível"}],
    ["es", "2000", "Pasivo", {"en": "Liabilities", "pt": "Passivo"}],
    ["es", "2100", "Pasivo Corriente", {"en": "Current Liabilities", "pt": "Passivo Circulante"}],
    ["es", "2110", "Cuentas por Pagar Comerciales", {"en": "Accounts Payable", "pt": "Fornecedores"}],
    ["es", "2115", "Mercancía Recibida No Facturada", {"en": "Goods Received Not Invoiced", "pt": "Mercadorias Recebidas Não Faturadas"}],
    ["es", "2120", "Gastos Acumulados por Pagar", {"en": "Accrued Expenses", "pt": "Despesas a Pagar"}],
    ["es", "2130", "IGV por Pagar (Débito Fiscal)", {"en": "IGV Payable", "pt": "IGV a Recolher"}],
    ["es", "2130", "ISV por Pagar (Débito Fiscal)", {"en": "ISV Payable", "pt": "ISV a Recolher"}],
    ["es", "2130", "ITBIS por Pagar (Débito Fiscal)", {"en": "ITBIS Payable", "pt": "ITBIS a Recolher"}],
    ["es", "2130", "ITBMS por Pagar (Débito Fiscal)", {"en": "ITBMS Payable", "pt": "ITBMS a Recolher"}],
    ["es", "2130", "IVA Básico por Pagar (Débito Fiscal)", {"en": "IVA Básico Payable", "pt": "IVA Básico a Recolher"}],
    ["es", "2130", "IVA por Pagar (Débito Fiscal)", {"en": "IVA Payable", "pt": "IVA a Recolher"}],
    ["es", "2135", "Retenciones por Pagar", {"en": "Taxes Withheld from Vendors", "pt": "Tributos Retidos de Terceiros"}],
    ["es", "2140", "Remuneraciones y Prestaciones por Pagar", {"en": "Payroll Liabilities", "pt": "Obrigações Trabalhistas"}],
    ["es", "2141", "AFP por Pagar (TSS)", {"en": "Pension Contributions Payable", "pt": "Previdência a Recolher"}],
    ["es", "2141", "Aportaciones SAR (Retiro, Cesantía y Vejez) por Pagar", {"en": "Pension Contributions Payable", "pt": "Previdência a Recolher"}],
    ["es", "2141", "Aportes a Fondos de Pensiones por Pagar", {"en": "Pension Contributions Payable", "pt": "Previdência a Recolher"}],
    ["es", "2141", "Aportes de Pensión por Pagar", {"en": "Pension Contributions Payable", "pt": "Previdência a Recolher"}],
    ["es", "2142", "Aportes a EPS por Pagar", {"en": "Health Contributions Payable", "pt": "Plano de Saúde a Recolher"}],
    ["es", "2142", "Aportes de Salud por Pagar", {"en": "Health Contributions Payable", "pt": "Plano de Saúde a Recolher"}],
    ["es", "2142", "Cuotas IMSS por Pagar", {"en": "Health Contributions Payable", "pt": "Plano de Saúde a Recolher"}],
    ["es", "2142", "SFS por Pagar (TSS)", {"en": "Health Contributions Payable", "pt": "Plano de Saúde a Recolher"}],
    ["es", "2143", "Aportaciones INFONAVIT por Pagar", {"en": "Other Payroll Contributions Payable", "pt": "Outros Encargos Trabalhistas a Recolher"}],
    ["es", "2143", "Aportes ARL y Parafiscales por Pagar", {"en": "Other Payroll Contributions Payable", "pt": "Outros Encargos Trabalhistas a Recolher"}],
    ["es", "2143", "Otros Aportes Laborales por Pagar", {"en": "Other Payroll Contributions Payable", "pt": "Outros Encargos Trabalhistas a Recolher"}],
    ["es", "2143", "SRL e INFOTEP por Pagar", {"en": "Other Payroll Contributions Payable", "pt": "Outros Encargos Trabalhistas a Recolher"}],
    ["es", "2144", "Impuesto sobre la Renta Retenido a Empleados por Pagar", {"en": "Payroll Income Tax Withheld", "pt": "IRRF a Recolher"}],
    ["es", "2144", "ISR de Empleados Retenido por Pagar", {"en": "Payroll Income Tax Withheld", "pt": "IRRF a Recolher"}],
    ["es", "2144", "ISR Retenido por Sueldos y Salarios por Pagar", {"en": "Payroll Income Tax Withheld", "pt": "IRRF a Recolher"}],
    ["es", "2144", "Retención en la Fuente por Salarios por Pagar", {"en": "Payroll Income Tax Withheld", "pt": "IRRF a Recolher"}],
    ["es", "2150", "Impuesto sobre la Renta por Pagar", {"en": "Income Tax Payable", "pt": "IRPJ e CSLL a Recolher"}],
    ["es", "2160", "Cargo por Servicio (10 %) por Pagar", {"en": "Service Charge Payable", "pt": "Gorjeta a Pagar"}],
    ["es", "2160", "Propina Legal por Pagar", {"en": "Service Charge Payable", "pt": "Gorjeta a Pagar"}],
    ["es", "2165", "ICE por Pagar", {"en": "Excise Tax Payable", "pt": "Impostos Seletivos a Recolher"}],
    ["es", "2165", "IEPS por Pagar", {"en": "Excise Tax Payable", "pt": "Impostos Seletivos a Recolher"}],
    ["es", "2165", "Impuesto Nacional al Consumo por Pagar", {"en": "Excise Tax Payable", "pt": "Impostos Seletivos a Recolher"}],
    ["es", "2165", "Impuesto Selectivo al Consumo por Pagar", {"en": "Excise Tax Payable", "pt": "Impostos Seletivos a Recolher"}],
    ["es", "2165", "Impuestos Específicos al Consumo por Pagar", {"en": "Excise Tax Payable", "pt": "Impostos Seletivos a Recolher"}],
    ["es", "2170", "Anticipos de Clientes", {"en": "Customer Advances", "pt": "Adiantamentos de Clientes"}],
    ["es", "2200", "Pasivo No Corriente", {"en": "Non-current Liabilities", "pt": "Passivo Não Circulante"}],
    ["es", "2210", "Deudas a Largo Plazo", {"en": "Long-term Debt", "pt": "Empréstimos de Longo Prazo"}],
    ["es", "3000", "Patrimonio", {"en": "Equity", "pt": "Patrimônio Líquido"}],
    ["es", "3100", "Capital Social", {"en": "Common Stock", "pt": "Capital Social"}],
    ["es", "3110", "Ajuste de Capital", {"en": "Restatement Adjustment: Common Stock", "pt": "Ajuste de Reexpressão: Capital Social"}],
    ["es", "3150", "Patrimonio por Saldos Iniciales", {"en": "Opening Balance Equity", "pt": "Património de Saldos Iniciais"}],
    ["es", "3200", "Reserva Legal", {"en": "Additional Paid-in Capital", "pt": "Reserva Legal"}],
    ["es", "3300", "Resultados Acumulados", {"en": "Retained Earnings", "pt": "Lucros ou Prejuízos Acumulados"}],
    ["es", "3400", "Resultado del Ejercicio", {"en": "Current Period Earnings", "pt": "Resultado do Exercício"}],
    ["es", "4000", "Ingresos", {"en": "Revenue", "pt": "Receitas"}],
    ["es", "4100", "Ingresos por Ventas", {"en": "Sales Revenue", "pt": "Receita de Vendas"}],
    ["es", "4200", "Ingresos por Servicios", {"en": "Service Revenue", "pt": "Receita de Serviços"}],
    ["es", "4300", "Descuentos y Devoluciones sobre Ventas", {"en": "Sales Returns and Allowances", "pt": "Descontos e Devoluções de Vendas"}],
    ["es", "4900", "Otros Ingresos", {"en": "Other Income", "pt": "Outras Receitas"}],
    ["es", "5000", "Gastos", {"en": "Expenses", "pt": "Despesas"}],
    ["es", "5100", "Costo de Ventas", {"en": "Cost of Goods Sold", "pt": "Custo das Mercadorias Vendidas"}],
    ["es", "5150", "Ajustes de Inventario", {"en": "Inventory Adjustments", "pt": "Ajustes de Estoque"}],
    ["es", "5200", "Sueldos y Salarios", {"en": "Salaries and Wages", "pt": "Salários e Ordenados"}],
    ["es", "5250", "Aportes Patronales (Seguridad Social y Parafiscales)", {"en": "Employer Payroll Contributions", "pt": "Encargos Sociais (Empregador)"}],
    ["es", "5250", "Aportes Patronales (TSS/INFOTEP)", {"en": "Employer Payroll Contributions", "pt": "Encargos Sociais (Empregador)"}],
    ["es", "5250", "Aportes Patronales a la Seguridad Social", {"en": "Employer Payroll Contributions", "pt": "Encargos Sociais (Empregador)"}],
    ["es", "5250", "Cuotas Patronales IMSS, SAR e INFONAVIT", {"en": "Employer Payroll Contributions", "pt": "Encargos Sociais (Empregador)"}],
    ["es", "5300", "Alquileres", {"en": "Rent Expense", "pt": "Aluguéis"}],
    ["es", "5400", "Servicios Públicos", {"en": "Utilities", "pt": "Serviços Públicos"}],
    ["es", "5500", "Gasto por Depreciación", {"en": "Depreciation Expense", "pt": "Despesa de Depreciação"}],
    ["es", "5600", "Honorarios Profesionales", {"en": "Professional Fees", "pt": "Honorários Profissionais"}],
    ["es", "5700", "Gastos Financieros", {"en": "Interest and Bank Charges", "pt": "Despesas Financeiras"}],
    ["es", "5750", "Diferencia Cambiaria Realizada", {"en": "Realized Foreign Exchange Gain or Loss", "pt": "Variação Cambial Realizada"}],
    ["es", "5755", "Diferencia Cambiaria No Realizada", {"en": "Unrealized Foreign Exchange Gain or Loss", "pt": "Variação Cambial Não Realizada"}],
    ["es", "5760", "Resultado por Exposición a la Inflación", {"en": "Inflation Adjustment Result", "pt": "Resultado da Exposição à Inflação"}],
    ["es", "5900", "Otros Gastos", {"en": "Other Expenses", "pt": "Outras Despesas"}],
    ["pt", "1000", "Ativo", {"en": "Assets", "es": "Activo"}],
    ["pt", "1100", "Ativo Circulante", {"en": "Current Assets", "es": "Activo Corriente"}],
    ["pt", "1110", "Caixa e Equivalentes de Caixa", {"en": "Cash and Cash Equivalents", "es": "Efectivo y Equivalentes de Efectivo"}],
    ["pt", "1120", "Bancos", {"en": "Bank Accounts", "es": "Bancos"}],
    ["pt", "1130", "Contas a Receber de Clientes", {"en": "Accounts Receivable", "es": "Cuentas por Cobrar Comerciales"}],
    ["pt", "1135", "Provisão para Créditos de Liquidação Duvidosa", {"en": "Allowance for Doubtful Accounts", "es": "Estimación para Cuentas Incobrables"}],
    ["pt", "1140", "Estoques", {"en": "Inventory", "es": "Inventarios"}],
    ["pt", "1150", "Tributos a Recuperar", {"en": "Tributos Receivable", "es": "Tributos por Cobrar (Crédito Fiscal)"}],
    ["pt", "1155", "Tributos Retidos por Clientes", {"en": "Tax Withheld by Customers", "es": "Retenciones a Favor"}],
    ["pt", "1160", "Despesas Antecipadas", {"en": "Prepaid Expenses", "es": "Gastos Pagados por Anticipado"}],
    ["pt", "1200", "Ativo Não Circulante", {"en": "Non-current Assets", "es": "Activo No Corriente"}],
    ["pt", "1210", "Imobilizado", {"en": "Property, Plant and Equipment", "es": "Propiedad, Planta y Equipo"}],
    ["pt", "1220", "Depreciação Acumulada", {"en": "Accumulated Depreciation", "es": "Depreciación Acumulada"}],
    ["pt", "1230", "Intangível", {"en": "Intangible Assets", "es": "Activos Intangibles"}],
    ["pt", "2000", "Passivo", {"en": "Liabilities", "es": "Pasivo"}],
    ["pt", "2100", "Passivo Circulante", {"en": "Current Liabilities", "es": "Pasivo Corriente"}],
    ["pt", "2110", "Fornecedores", {"en": "Accounts Payable", "es": "Cuentas por Pagar Comerciales"}],
    ["pt", "2115", "Mercadorias Recebidas Não Faturadas", {"en": "Goods Received Not Invoiced", "es": "Mercancía Recibida No Facturada"}],
    ["pt", "2120", "Despesas a Pagar", {"en": "Accrued Expenses", "es": "Gastos Acumulados por Pagar"}],
    ["pt", "2130", "Tributos a Recolher", {"en": "Tributos Payable", "es": "Tributos por Pagar (Débito Fiscal)"}],
    ["pt", "2135", "Tributos Retidos de Terceiros", {"en": "Taxes Withheld from Vendors", "es": "Retenciones por Pagar"}],
    ["pt", "2140", "Obrigações Trabalhistas", {"en": "Payroll Liabilities", "es": "Remuneraciones y Prestaciones por Pagar"}],
    ["pt", "2141", "Previdência a Recolher", {"en": "Pension Contributions Payable", "es": "Aportes de Pensión por Pagar"}],
    ["pt", "2142", "Plano de Saúde a Recolher", {"en": "Health Contributions Payable", "es": "Aportes de Salud por Pagar"}],
    ["pt", "2143", "Outros Encargos Trabalhistas a Recolher", {"en": "Other Payroll Contributions Payable", "es": "Otros Aportes Laborales por Pagar"}],
    ["pt", "2144", "IRRF a Recolher", {"en": "Payroll Income Tax Withheld", "es": "Impuesto sobre la Renta Retenido a Empleados por Pagar"}],
    ["pt", "2150", "IRPJ e CSLL a Recolher", {"en": "Income Tax Payable", "es": "Impuesto sobre la Renta por Pagar"}],
    ["pt", "2165", "Impostos Seletivos a Recolher", {"en": "Excise Tax Payable", "es": "Impuestos Específicos al Consumo por Pagar"}],
    ["pt", "2170", "Adiantamentos de Clientes", {"en": "Customer Advances", "es": "Anticipos de Clientes"}],
    ["pt", "2200", "Passivo Não Circulante", {"en": "Non-current Liabilities", "es": "Pasivo No Corriente"}],
    ["pt", "2210", "Empréstimos de Longo Prazo", {"en": "Long-term Debt", "es": "Deudas a Largo Plazo"}],
    ["pt", "3000", "Patrimônio Líquido", {"en": "Equity", "es": "Patrimonio"}],
    ["pt", "3100", "Capital Social", {"en": "Common Stock", "es": "Capital Social"}],
    ["pt", "3150", "Património de Saldos Iniciais", {"en": "Opening Balance Equity", "es": "Patrimonio por Saldos Iniciales"}],
    ["pt", "3200", "Reserva Legal", {"en": "Additional Paid-in Capital", "es": "Reserva Legal"}],
    ["pt", "3300", "Lucros ou Prejuízos Acumulados", {"en": "Retained Earnings", "es": "Resultados Acumulados"}],
    ["pt", "3400", "Resultado do Exercício", {"en": "Current Period Earnings", "es": "Resultado del Ejercicio"}],
    ["pt", "4000", "Receitas", {"en": "Revenue", "es": "Ingresos"}],
    ["pt", "4100", "Receita de Vendas", {"en": "Sales Revenue", "es": "Ingresos por Ventas"}],
    ["pt", "4200", "Receita de Serviços", {"en": "Service Revenue", "es": "Ingresos por Servicios"}],
    ["pt", "4300", "Descontos e Devoluções de Vendas", {"en": "Sales Returns and Allowances", "es": "Descuentos y Devoluciones sobre Ventas"}],
    ["pt", "4900", "Outras Receitas", {"en": "Other Income", "es": "Otros Ingresos"}],
    ["pt", "5000", "Despesas", {"en": "Expenses", "es": "Gastos"}],
    ["pt", "5100", "Custo das Mercadorias Vendidas", {"en": "Cost of Goods Sold", "es": "Costo de Ventas"}],
    ["pt", "5150", "Ajustes de Estoque", {"en": "Inventory Adjustments", "es": "Ajustes de Inventario"}],
    ["pt", "5200", "Salários e Ordenados", {"en": "Salaries and Wages", "es": "Sueldos y Salarios"}],
    ["pt", "5250", "Encargos Sociais (Empregador)", {"en": "Employer Payroll Contributions", "es": "Aportes Patronales a la Seguridad Social"}],
    ["pt", "5300", "Aluguéis", {"en": "Rent Expense", "es": "Alquileres"}],
    ["pt", "5400", "Serviços Públicos", {"en": "Utilities", "es": "Servicios Públicos"}],
    ["pt", "5500", "Despesa de Depreciação", {"en": "Depreciation Expense", "es": "Gasto por Depreciación"}],
    ["pt", "5600", "Honorários Profissionais", {"en": "Professional Fees", "es": "Honorarios Profesionales"}],
    ["pt", "5700", "Despesas Financeiras", {"en": "Interest and Bank Charges", "es": "Gastos Financieros"}],
    ["pt", "5750", "Variação Cambial Realizada", {"en": "Realized Foreign Exchange Gain or Loss", "es": "Diferencia Cambiaria Realizada"}],
    ["pt", "5755", "Variação Cambial Não Realizada", {"en": "Unrealized Foreign Exchange Gain or Loss", "es": "Diferencia Cambiaria No Realizada"}],
    ["pt", "5760", "Resultado da Exposição à Inflação", {"en": "Inflation Adjustment Result", "es": "Resultado por Exposición a la Inflación"}],
    ["pt", "5900", "Outras Despesas", {"en": "Other Expenses", "es": "Otros Gastos"}],
  ];

  /**
   * The language a company keeps its books in, as `ChartOfAccountsService.booksLanguage` resolves
   * it: the one recorded, else its country's (the markets whose books are not in Spanish, as they
   * stood when this was written), else Spanish. A row of the plan is only ever matched against the
   * names of a company that keeps its books in that row's language: once translated, a Dominican
   * «Bancos» also reads «Bank Accounts», and must never be taken for a US account of that name.
   */
  private static readonly BOOKS_LANGUAGE = `COALESCE(NULLIF(o."books_language", ''), CASE UPPER(COALESCE(o."country", '')) WHEN 'US' THEN 'en' WHEN 'BR' THEN 'pt' ELSE 'es' END)`;

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "accounts" a
          SET "name" = v.translations || a."name"
         FROM jsonb_to_recordset($1::jsonb) AS v(books text, code text, books_name text, translations jsonb),
              "organizations" o
        WHERE o."id" = a."organization_id"
          AND v.books = ${AccountNameTranslations1789810000000.BOOKS_LANGUAGE}
          AND a."code" = v.code
          AND a."name" ->> v.books = v.books_name`,
      [this.rows()],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // Each translation goes only where it is still exactly what this migration wrote, and never
    // the books language.
    for (const language of ['es', 'en', 'pt']) {
      await q.query(
        `UPDATE "accounts" a
            SET "name" = a."name" - $2::text
           FROM jsonb_to_recordset($1::jsonb) AS v(books text, code text, books_name text, translations jsonb),
                "organizations" o
          WHERE o."id" = a."organization_id"
            AND v.books = ${AccountNameTranslations1789810000000.BOOKS_LANGUAGE}
            AND v.books <> $2
            AND a."code" = v.code
            AND a."name" ->> v.books = v.books_name
            AND a."name" ->> $2 = v.translations ->> $2`,
        [this.rows(), language],
      );
    }
  }

  private rows(): string {
    return JSON.stringify(
      AccountNameTranslations1789810000000.PLAN_NAMES.map(([books, code, booksName, translations]) => ({
        books,
        code,
        books_name: booksName,
        translations,
      })),
    );
  }
}
