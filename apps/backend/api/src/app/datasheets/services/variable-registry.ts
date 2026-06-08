
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
  permission: string;
}

export const VARIABLE_REGISTRY: ERPVariable[] = [
  // 3.3 Catálogo de Variables — Módulo Financiero
  { nameEn: 'TOTAL_SALES', nameEs: 'VENTA_TOTAL', module: VariableModule.FINANCIAL, permission: 'sales:view', descriptionEn: 'Total sum of all sales registered historically', descriptionEs: 'Suma de todas las ventas registradas históricamente' },
  { nameEn: 'TODAY_SALES', nameEs: 'VENTA_HOY', module: VariableModule.FINANCIAL, permission: 'sales:view', descriptionEn: 'Total sales of the current day', descriptionEs: 'Total de ventas del día en curso' },
  { nameEn: 'MONTH_SALES', nameEs: 'VENTA_MES', module: VariableModule.FINANCIAL, permission: 'sales:view', descriptionEn: 'Total sales of the current month', descriptionEs: 'Total de ventas del mes actual' },
  { nameEn: 'PREVIOUS_MONTH_SALES', nameEs: 'VENTA_MES_ANTERIOR', module: VariableModule.FINANCIAL, permission: 'sales:view', descriptionEn: 'Total sales of the previous month', descriptionEs: 'Total del mes inmediatamente anterior' },
  { nameEn: 'YEAR_SALES', nameEs: 'VENTA_ANIO', module: VariableModule.FINANCIAL, permission: 'sales:view', descriptionEn: 'Total sales of the current fiscal year', descriptionEs: 'Total de ventas del año fiscal en curso' },
  { nameEn: 'GOAL_FULFILLMENT', nameEs: 'CUMPLIMIENTO_META', module: VariableModule.FINANCIAL, permission: 'sales:view', descriptionEn: 'Percentage of current monthly goal fulfillment', descriptionEs: 'Porcentaje de cumplimiento de la meta mensual actual' },
  { nameEn: 'AVERAGE_TICKET', nameEs: 'TICKET_PROMEDIO', module: VariableModule.FINANCIAL, permission: 'sales:view', descriptionEn: 'Average value per sales transaction', descriptionEs: 'Valor promedio por transacción de venta' },

  // 3.4 Catálogo de Variables — Costos y Utilidad
  { nameEn: 'SALES_COST', nameEs: 'COSTO_VENTAS', module: VariableModule.COSTS, permission: 'accounting:view', descriptionEn: 'Direct cost of goods sold (COGS)', descriptionEs: 'Costo directo de los productos vendidos (COGS)' },
  { nameEn: 'GROSS_PROFIT', nameEs: 'UTILIDAD_BRUTA', module: VariableModule.COSTS, permission: 'accounting:view', descriptionEn: 'VENTA_TOTAL - COSTO_VENTAS calculated automatically', descriptionEs: 'VENTA_TOTAL - COSTO_VENTAS calculado automáticamente' },
  { nameEn: 'GROSS_MARGIN', nameEs: 'MARGEN_BRUTO', module: VariableModule.COSTS, permission: 'accounting:view', descriptionEn: 'Global gross margin percentage', descriptionEs: 'Porcentaje de margen bruto global' },
  { nameEn: 'EBITDA', nameEs: 'EBITDA', module: VariableModule.COSTS, permission: 'accounting:view', descriptionEn: 'Earnings before interest, taxes, depreciation, and amortization', descriptionEs: 'Utilidad antes de intereses, impuestos y amortizaciones' },
  { nameEn: 'MONTH_ROI', nameEs: 'ROI_MES', module: VariableModule.COSTS, permission: 'accounting:view', descriptionEn: 'Return on investment of the current month', descriptionEs: 'Retorno sobre inversión del mes actual' },

  // 3.5 Catálogo de Variables — Inventario
  { nameEn: 'INVENTORY_VALUE', nameEs: 'VALOR_INVENTARIO', module: VariableModule.INVENTORY, permission: 'inventory:view', descriptionEn: 'Total inventory value at current cost', descriptionEs: 'Valor total del inventario al costo actual' },
  { nameEn: 'UNITS_IN_STOCK', nameEs: 'UNIDADES_EN_STOCK', module: VariableModule.INVENTORY, permission: 'inventory:view', descriptionEn: 'Total number of physical units in all warehouses', descriptionEs: 'Cantidad total de unidades físicas en todos los almacenes' },
  { nameEn: 'OUT_OF_STOCK_PRODUCTS', nameEs: 'PRODUCTOS_SIN_STOCK', module: VariableModule.INVENTORY, permission: 'inventory:view', descriptionEn: 'Products with zero stock', descriptionEs: 'Productos con stock en cero' },
  { nameEn: 'INVENTORY_TURNOVER', nameEs: 'ROTACION_INVENTARIO', module: VariableModule.INVENTORY, permission: 'inventory:view', descriptionEn: 'Inventory turnover ratio', descriptionEs: 'Número de veces que el inventario completo se vende en el año' },
  { nameEn: 'PRODUCT_COST', nameEs: 'COSTO_PRODUCTO', module: VariableModule.INVENTORY, params: ['ref'], permission: 'inventory:view', descriptionEn: 'Current cost of a specific product by reference', descriptionEs: 'Costo actual de un producto específico por referencia' },
  { nameEn: 'PRODUCT_STOCK', nameEs: 'STOCK_PRODUCTO', module: VariableModule.INVENTORY, params: ['ref'], permission: 'inventory:view', descriptionEn: 'Stock units of a specific product', descriptionEs: 'Unidades en stock de un producto específico' },

  // 3.6 Catálogo de Variables — Cuentas por Cobrar
  { nameEn: 'ACCOUNTS_RECEIVABLE', nameEs: 'CUENTAS_POR_COBRAR', module: VariableModule.AR, permission: 'accounting:view', descriptionEn: 'Total balance pending collection from all customers', descriptionEs: 'Saldo total pendiente de cobro a todos los clientes' },
  { nameEn: 'OVERDUE_AR', nameEs: 'CXC_VENCIDAS', module: VariableModule.AR, permission: 'accounting:view', descriptionEn: 'Amount of accounts past their due date', descriptionEs: 'Monto de cuentas que ya pasaron su fecha límite' },
  { nameEn: 'DELINQUENCY_INDEX', nameEs: 'INDICE_MOROSIDAD', module: VariableModule.AR, permission: 'accounting:view', descriptionEn: 'Percentage of the portfolio that is in arrears', descriptionEs: 'Porcentaje de la cartera que está en mora' },
  { nameEn: 'CUSTOMER_DEBT', nameEs: 'CLIENTE_DEUDA', module: VariableModule.AR, params: ['id'], permission: 'accounting:view', descriptionEn: 'Total debt of a specific customer', descriptionEs: 'Deuda total de un cliente específico' },

  // 3.7 Catálogo de Variables — Cuentas por Pagar y Compras
  { nameEn: 'ACCOUNTS_PAYABLE', nameEs: 'CUENTAS_POR_PAGAR', module: VariableModule.AP, permission: 'accounting:view', descriptionEn: 'Total debt pending with all suppliers', descriptionEs: 'Total de deudas pendientes con todos los proveedores' },
  { nameEn: 'MONTH_PURCHASES', nameEs: 'COMPRAS_MES', module: VariableModule.AP, permission: 'purchasing:view', descriptionEn: 'Total purchases made in the month', descriptionEs: 'Total de compras realizadas en el mes' },

  // 3.8 Catálogo de Variables — Flujo de Caja y Tesorería
  { nameEn: 'CURRENT_CASH_FLOW', nameEs: 'FLUJO_CAJA_ACTUAL', module: VariableModule.CASHFLOW, permission: 'accounting:view', descriptionEn: 'Available balance in cash and banks at this moment', descriptionEs: 'Saldo disponible en caja y bancos en este momento' },
  { nameEn: 'PROJECTED_CASH_FLOW', nameEs: 'FLUJO_CAJA_PROYECTADO', module: VariableModule.CASHFLOW, permission: 'accounting:view', descriptionEn: 'Cash projection based on pending AR and AP', descriptionEs: 'Proyección de caja basada en CxC y CxP pendientes' },

  // 3.9 Catálogo de Variables — Nómina y Recursos Humanos
  { nameEn: 'TOTAL_PAYROLL_MONTH', nameEs: 'NOMINA_TOTAL_MES', module: VariableModule.HR, permission: 'hcm:view', descriptionEn: 'Total payroll cost of the month including social charges', descriptionEs: 'Costo total de nómina del mes incluyendo cargas sociales' },
  { nameEn: 'ACTIVE_EMPLOYEES', nameEs: 'EMPLEADOS_ACTIVOS', module: VariableModule.HR, permission: 'hcm:view', descriptionEn: 'Total number of active employees', descriptionEs: 'Número total de empleados activos' },

  // 3.10 Catálogo de Variables — Fiscal y Tributario
  { nameEn: 'TAX_RATE', nameEs: 'ITEBIS', module: VariableModule.FISCAL, permission: 'accounting:view', descriptionEn: 'ITEBIS/VAT rate configured in the system', descriptionEs: 'Tasa de ITEBIS/IVA configurada en el sistema' },
  { nameEn: 'EXCHANGE_RATE', nameEs: 'TASA_CAMBIO', module: VariableModule.FISCAL, permission: 'accounting:view', descriptionEn: 'Current exchange rate between base and secondary currency', descriptionEs: 'Tasa de cambio actual entre divisa base y secundaria' },

  // 3.11 Catálogo de Variables — Ventas Avanzadas
  { nameEn: 'SALES_BY_SALESPERSON', nameEs: 'VENTA_VENDEDOR', module: VariableModule.SALES, params: ['nombre'], permission: 'sales:view', descriptionEn: 'Total sales generated by a specific salesperson', descriptionEs: 'Total de ventas generadas por un vendedor específico' },
  { nameEn: 'TOP_SELLING_PRODUCT', nameEs: 'PRODUCTO_MAS_VENDIDO', module: VariableModule.SALES, permission: 'sales:view', descriptionEn: 'Name of the product with the highest sales volume of the month', descriptionEs: 'Nombre del producto con mayor volumen de ventas del mes' },

  // 3.13 Variables de Sistema y Configuración
  { nameEn: 'COMPANY_NAME', nameEs: 'EMPRESA_NOMBRE', module: VariableModule.SYSTEM, permission: 'common:view', descriptionEn: 'Legal name of the company', descriptionEs: 'Nombre legal de la empresa' },
  { nameEn: 'COMPANY_TAX_ID', nameEs: 'EMPRESA_RNC', module: VariableModule.SYSTEM, permission: 'common:view', descriptionEn: 'RNC or tax identification number of the company', descriptionEs: 'RNC o número de identificación fiscal de la empresa' },
  { nameEn: 'TODAY_DATE', nameEs: 'FECHA_HOY', module: VariableModule.SYSTEM, permission: 'common:view', descriptionEn: 'Current system server date', descriptionEs: 'Fecha actual del servidor del sistema' },
  { nameEn: 'CURRENT_USER_NAME', nameEs: 'USUARIO_ACTUAL', module: VariableModule.SYSTEM, permission: 'common:view', descriptionEn: 'Name of the user editing the book', descriptionEs: 'Nombre del usuario que está editando el libro' },
];
