import { PERMISSIONS } from '../../shared/permissions';

export enum VariableModule {
  FINANCIAL = 'FINANCIAL',
  COSTS = 'COSTS',
  INVENTORY = 'INVENTORY',
  AR = 'AR',
  AP = 'AP',
  CASHFLOW = 'CASHFLOW',
  HR = 'HR',
  FISCAL = 'FISCAL',
  SALES = 'SALES',
  SYSTEM = 'SYSTEM'
}

export interface ERPVariable {
  nameEn: string;
  nameEs: string;
  module: VariableModule;
  descriptionEn: string;
  descriptionEs: string;
  params?: string[];
  /**
   * The permission a caller must hold to resolve this variable, or `null` when belonging to the
   * tenant is enough — the company's own name, its tax id, today's date, the caller's own name.
   *
   * Declared here and **enforced** by `DatasheetVariablesService`. It used to be declared here and
   * enforced nowhere: `POST /datasheets/resolve-variables` carried only `JwtAuthGuard`, and the
   * resolver never read this field, so any authenticated member of the tenant — a seller, a
   * read-only user — could pull EBITDA, the cash position, gross margin, the cost of any product
   * and the whole sales history through a spreadsheet formula.
   */
  permission: string | null;
}

/**
 * The variables a spreadsheet may reference.
 *
 * ## Every entry here resolves from real data
 *
 * A variable in this list is a promise that the product can answer it from the tenant's own
 * records. Four entries used to break that promise and were removed rather than left returning a
 * number nobody could trace:
 *
 * * `PROJECTED_CASH_FLOW` had no `case` in the resolver at all, so it fell through to `default:
 *   value = 0`. It is now computed from real receivables and payables due in the horizon.
 * * `GOAL_FULFILLMENT` divided by `const goal = 1000000; // Mock goal from settings`. It now reads
 *   the tenant's revenue budget for the month, which is a figure somebody actually entered.
 * * `TOTAL_PAYROLL_MONTH` promised "total payroll cost of the month including social charges" from
 *   a module whose entire contents are `Employee` and `Department` — there is no payroll run, no
 *   concept, no accrual. It is gone until there is something to read.
 * * `SALES_BY_SALESPERSON` needs a salesperson on the sales document, and no such column exists.
 *   Gone for the same reason.
 *
 * Removing a variable is a visible, explainable gap. Returning zero, or a hardcoded million, is an
 * invisible one that lands inside somebody's financial model.
 */
export const VARIABLE_REGISTRY: ERPVariable[] = [
  // Módulo Financiero
  { nameEn: 'TOTAL_SALES', nameEs: 'VENTA_TOTAL', module: VariableModule.FINANCIAL, permission: PERMISSIONS.INVOICES_VIEW, descriptionEn: 'Total sum of all sales invoiced historically, net of credit notes', descriptionEs: 'Suma de todas las ventas facturadas históricamente, neta de notas de crédito' },
  { nameEn: 'TODAY_SALES', nameEs: 'VENTA_HOY', module: VariableModule.FINANCIAL, permission: PERMISSIONS.INVOICES_VIEW, descriptionEn: 'Sales invoiced today', descriptionEs: 'Ventas facturadas hoy' },
  { nameEn: 'MONTH_SALES', nameEs: 'VENTA_MES', module: VariableModule.FINANCIAL, permission: PERMISSIONS.INVOICES_VIEW, descriptionEn: 'Sales invoiced in the current month', descriptionEs: 'Ventas facturadas en el mes actual' },
  { nameEn: 'PREVIOUS_MONTH_SALES', nameEs: 'VENTA_MES_ANTERIOR', module: VariableModule.FINANCIAL, permission: PERMISSIONS.INVOICES_VIEW, descriptionEn: 'Sales invoiced in the previous month', descriptionEs: 'Ventas facturadas en el mes anterior' },
  { nameEn: 'YEAR_SALES', nameEs: 'VENTA_ANIO', module: VariableModule.FINANCIAL, permission: PERMISSIONS.INVOICES_VIEW, descriptionEn: 'Sales invoiced in the current calendar year', descriptionEs: 'Ventas facturadas en el año calendario en curso' },
  { nameEn: 'GOAL_FULFILLMENT', nameEs: 'CUMPLIMIENTO_META', module: VariableModule.FINANCIAL, permission: PERMISSIONS.ACCOUNTING_VIEW, descriptionEn: 'Percentage of the month\'s revenue budget achieved', descriptionEs: 'Porcentaje del presupuesto de ingresos del mes alcanzado' },
  { nameEn: 'AVERAGE_TICKET', nameEs: 'TICKET_PROMEDIO', module: VariableModule.FINANCIAL, permission: PERMISSIONS.INVOICES_VIEW, descriptionEn: 'Average value per invoiced sales document', descriptionEs: 'Valor promedio por documento de venta emitido' },

  // Costos y Utilidad
  { nameEn: 'SALES_COST', nameEs: 'COSTO_VENTAS', module: VariableModule.COSTS, permission: PERMISSIONS.ACCOUNTING_VIEW, descriptionEn: 'Cost of goods sold for the year to date, from the ledger', descriptionEs: 'Costo de ventas del año en curso, tomado del mayor' },
  { nameEn: 'GROSS_PROFIT', nameEs: 'UTILIDAD_BRUTA', module: VariableModule.COSTS, permission: PERMISSIONS.ACCOUNTING_VIEW, descriptionEn: 'Revenue less cost of sales for the year to date', descriptionEs: 'Ingresos menos costo de ventas del año en curso' },
  { nameEn: 'GROSS_MARGIN', nameEs: 'MARGEN_BRUTO', module: VariableModule.COSTS, permission: PERMISSIONS.ACCOUNTING_VIEW, descriptionEn: 'Gross margin percentage for the year to date', descriptionEs: 'Porcentaje de margen bruto del año en curso' },
  { nameEn: 'EBITDA', nameEs: 'EBITDA', module: VariableModule.COSTS, permission: PERMISSIONS.ACCOUNTING_VIEW, descriptionEn: 'Earnings before interest, taxes, depreciation, and amortization', descriptionEs: 'Utilidad antes de intereses, impuestos y amortizaciones' },

  // Inventario
  { nameEn: 'INVENTORY_VALUE', nameEs: 'VALOR_INVENTARIO', module: VariableModule.INVENTORY, permission: PERMISSIONS.INVENTORY_VIEW_STOCK, descriptionEn: 'Total inventory value at current cost', descriptionEs: 'Valor total del inventario al costo actual' },
  { nameEn: 'UNITS_IN_STOCK', nameEs: 'UNIDADES_EN_STOCK', module: VariableModule.INVENTORY, permission: PERMISSIONS.INVENTORY_VIEW_STOCK, descriptionEn: 'Total number of physical units in stock', descriptionEs: 'Cantidad total de unidades físicas en existencia' },
  { nameEn: 'OUT_OF_STOCK_PRODUCTS', nameEs: 'PRODUCTOS_SIN_STOCK', module: VariableModule.INVENTORY, permission: PERMISSIONS.INVENTORY_VIEW_STOCK, descriptionEn: 'Number of tracked products with zero stock', descriptionEs: 'Cantidad de productos inventariables con existencia en cero' },
  { nameEn: 'PRODUCT_COST', nameEs: 'COSTO_PRODUCTO', module: VariableModule.INVENTORY, params: ['ref'], permission: PERMISSIONS.PRODUCTS_VIEW, descriptionEn: 'Current cost of a specific product by SKU', descriptionEs: 'Costo actual de un producto específico por SKU' },
  { nameEn: 'PRODUCT_STOCK', nameEs: 'STOCK_PRODUCTO', module: VariableModule.INVENTORY, params: ['ref'], permission: PERMISSIONS.INVENTORY_VIEW_STOCK, descriptionEn: 'Stock units of a specific product by SKU', descriptionEs: 'Unidades en existencia de un producto específico por SKU' },

  // Cuentas por Cobrar
  { nameEn: 'ACCOUNTS_RECEIVABLE', nameEs: 'CUENTAS_POR_COBRAR', module: VariableModule.AR, permission: PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW, descriptionEn: 'Total balance pending collection from all customers', descriptionEs: 'Saldo total pendiente de cobro a todos los clientes' },
  { nameEn: 'OVERDUE_AR', nameEs: 'CXC_VENCIDAS', module: VariableModule.AR, permission: PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW, descriptionEn: 'Receivable balance past its due date', descriptionEs: 'Saldo por cobrar que ya pasó su fecha de vencimiento' },
  { nameEn: 'DELINQUENCY_INDEX', nameEs: 'INDICE_MOROSIDAD', module: VariableModule.AR, permission: PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW, descriptionEn: 'Percentage of the receivable portfolio that is overdue', descriptionEs: 'Porcentaje de la cartera por cobrar que está vencida' },
  { nameEn: 'CUSTOMER_DEBT', nameEs: 'CLIENTE_DEUDA', module: VariableModule.AR, params: ['id'], permission: PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW, descriptionEn: 'Outstanding balance of a specific customer', descriptionEs: 'Saldo pendiente de un cliente específico' },

  // Cuentas por Pagar y Compras
  { nameEn: 'ACCOUNTS_PAYABLE', nameEs: 'CUENTAS_POR_PAGAR', module: VariableModule.AP, permission: PERMISSIONS.ACCOUNTS_PAYABLE_VIEW, descriptionEn: 'Total balance pending with all suppliers', descriptionEs: 'Saldo total pendiente con todos los proveedores' },
  { nameEn: 'MONTH_PURCHASES', nameEs: 'COMPRAS_MES', module: VariableModule.AP, permission: PERMISSIONS.ACCOUNTS_PAYABLE_VIEW, descriptionEn: 'Supplier bills recorded in the current month', descriptionEs: 'Facturas de proveedor registradas en el mes actual' },

  // Flujo de Caja y Tesorería
  { nameEn: 'CURRENT_CASH_FLOW', nameEs: 'FLUJO_CAJA_ACTUAL', module: VariableModule.CASHFLOW, permission: PERMISSIONS.TREASURY_VIEW, descriptionEn: 'Balance in cash and bank accounts right now', descriptionEs: 'Saldo disponible en caja y bancos en este momento' },
  { nameEn: 'PROJECTED_CASH_FLOW', nameEs: 'FLUJO_CAJA_PROYECTADO', module: VariableModule.CASHFLOW, params: ['dias'], permission: PERMISSIONS.TREASURY_VIEW, descriptionEn: 'Cash today plus receivables due, less payables due, within N days (default 30)', descriptionEs: 'Caja de hoy más cobros por vencer, menos pagos por vencer, en N días (30 por defecto)' },

  // Recursos Humanos
  { nameEn: 'ACTIVE_EMPLOYEES', nameEs: 'EMPLEADOS_ACTIVOS', module: VariableModule.HR, permission: PERMISSIONS.HCM_VIEW, descriptionEn: 'Number of employees on record', descriptionEs: 'Número de empleados registrados' },

  // Fiscal y Tributario
  { nameEn: 'TAX_RATE', nameEs: 'ITEBIS', module: VariableModule.FISCAL, permission: PERMISSIONS.ACCOUNTING_VIEW, descriptionEn: 'Standard consumption-tax rate of the organization\'s country', descriptionEs: 'Tasa estándar del impuesto al consumo del país de la organización' },
  { nameEn: 'EXCHANGE_RATE', nameEs: 'TASA_CAMBIO', module: VariableModule.FISCAL, params: ['moneda'], permission: PERMISSIONS.ACCOUNTING_VIEW, descriptionEn: 'Today\'s rate from the given currency into the books\' currency', descriptionEs: 'Tasa de hoy de la moneda indicada hacia la moneda de los libros' },

  // Ventas Avanzadas
  { nameEn: 'TOP_SELLING_PRODUCT', nameEs: 'PRODUCTO_MAS_VENDIDO', module: VariableModule.SALES, permission: PERMISSIONS.INVOICES_VIEW, descriptionEn: 'Name of the product with the highest invoiced amount this month', descriptionEs: 'Nombre del producto con mayor monto facturado en el mes' },

  // Sistema y Configuración
  { nameEn: 'COMPANY_NAME', nameEs: 'EMPRESA_NOMBRE', module: VariableModule.SYSTEM, permission: null, descriptionEn: 'Legal name of the company', descriptionEs: 'Nombre legal de la empresa' },
  { nameEn: 'COMPANY_TAX_ID', nameEs: 'EMPRESA_RNC', module: VariableModule.SYSTEM, permission: null, descriptionEn: 'Tax identification number of the company', descriptionEs: 'Número de identificación fiscal de la empresa' },
  { nameEn: 'TODAY_DATE', nameEs: 'FECHA_HOY', module: VariableModule.SYSTEM, permission: null, descriptionEn: 'Today\'s date in the tenant\'s timezone', descriptionEs: 'Fecha de hoy en la zona horaria del inquilino' },
  { nameEn: 'CURRENT_USER_NAME', nameEs: 'USUARIO_ACTUAL', module: VariableModule.SYSTEM, permission: null, descriptionEn: 'Name of the user resolving the sheet', descriptionEs: 'Nombre del usuario que está resolviendo la hoja' },
];
