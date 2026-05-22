// ../localization/templates/do-fiscal-package.ts
import { NcfType } from "../../compliance/entities/ncf-sequence.entity";
import { TaxType } from "../../taxes/entities/tax.entity";
import { AccountNature, AccountType, AccountCategory } from "../../chart-of-accounts/enums/account-enums";
import { AccountTemplateDto } from "../entities/coa-template.entity";

interface FiscalPackage {
  countryCode: string;
  baseCurrency: string;
  coaTemplate: AccountTemplateDto[];
  taxTemplates: Array<{ name: string; rate: number; type: TaxType }>;
  ncfSequences: Array<{ type: NcfType; prefix: string; startsAt: number; endsAt: number }>;
  reportDefinitions: Record<string, any>;
  eInvoiceProviderConfig: Record<string, any>;
}

export const dominicanRepublicPackage: FiscalPackage = {
  countryCode: 'DO',
  baseCurrency: 'DOP',
  coaTemplate: [
    {
      segments: ['1'], name: 'Activos', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: false,
      children: [
        {
          segments: ['1', '01'], name: 'Activos Corrientes', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: false,
          children: [
            { segments: ['1', '01', '01'], name: 'Efectivo y Equivalentes', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: false,
              children: [
                { segments: ['1', '01', '01', '001'], name: 'Caja General', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
                { segments: ['1', '01', '01', '002'], name: 'Bancos Moneda Nacional', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
                { segments: ['1', '01', '01', '003'], name: 'Bancos Moneda Extranjera', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true, isMultiCurrency: true },
              ]
            },
            { segments: ['1', '01', '02'], name: 'Cuentas por Cobrar', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: false,
              children: [
                { segments: ['1', '01', '02', '001'], name: 'Cuentas por Cobrar Clientes', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true, isSystemAccount: true },
                { segments: ['1', '01', '02', '002'], name: 'Provisión Cuentas Incobrables', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.CREDIT, isPostable: true },
              ]
            },
            { segments: ['1', '01', '03'], name: 'Inventarios', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true, isSystemAccount: true },
            { segments: ['1', '01', '04'], name: 'Pagos Anticipados', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: false, 
              children: [
                { segments: ['1', '01', '04', '001'], name: 'ITBIS Pagado por Adelantado', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
              ]
            },
          ]
        },
        {
          segments: ['1', '02'], name: 'Activos No Corrientes', type: AccountType.ASSET, category: AccountCategory.NON_CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: false,
          children: [
            { segments: ['1', '02', '01'], name: 'Propiedad, Planta y Equipo', type: AccountType.ASSET, category: AccountCategory.NON_CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
            { segments: ['1', '02', '02'], name: 'Depreciación Acumulada', type: AccountType.ASSET, category: AccountCategory.NON_CURRENT_ASSET, nature: AccountNature.CREDIT, isPostable: true, isSystemAccount: true },
          ]
        },
      ],
    },
    {
      segments: ['2'], name: 'Pasivos', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: false,
      children: [
        { segments: ['2', '01'], name: 'Pasivos Corrientes', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: false,
          children: [
            { segments: ['2', '01', '01'], name: 'Cuentas por Pagar', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: true, isSystemAccount: true },
            { segments: ['2', '01', '02'], name: 'Impuestos por Pagar', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: false, 
              children: [
                { segments: ['2', '01', '02', '001'], name: 'ITBIS por Pagar', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: true, isSystemAccount: true },
                { segments: ['2', '01', '02', '002'], name: 'Retenciones por Pagar', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: true },
              ]
            },
          ]
        },
      ]
    },
    {
      segments: ['3'], name: 'Patrimonio', type: AccountType.EQUITY, category: AccountCategory.OWNERS_EQUITY, nature: AccountNature.CREDIT, isPostable: false,
      children: [
        { segments: ['3', '01', '01'], name: 'Capital', type: AccountType.EQUITY, category: AccountCategory.OWNERS_EQUITY, nature: AccountNature.CREDIT, isPostable: false, 
          children: [
            { segments: ['3', '01', '01', '001'], name: 'Capital Social Pagado', type: AccountType.EQUITY, category: AccountCategory.OWNERS_EQUITY, nature: AccountNature.CREDIT, isPostable: true },
          ]
        },
        { segments: ['3', '01', '02'], name: 'Resultados', type: AccountType.EQUITY, category: AccountCategory.RETAINED_EARNINGS, nature: AccountNature.CREDIT, isPostable: false,
          children: [
            { segments: ['3', '01', '02', '001'], name: 'Resultados Acumulados', type: AccountType.EQUITY, category: AccountCategory.RETAINED_EARNINGS, nature: AccountNature.CREDIT, isPostable: true, isSystemAccount: true },
            { segments: ['3', '01', '02', '002'], name: 'Resultado del Período', type: AccountType.EQUITY, category: AccountCategory.RETAINED_EARNINGS, nature: AccountNature.CREDIT, isPostable: true, isSystemAccount: true },
          ]
        },
      ]
    },
    {
      segments: ['4'], name: 'Ingresos', type: AccountType.REVENUE, category: AccountCategory.OPERATING_REVENUE, nature: AccountNature.CREDIT, isPostable: false,
      children: [
        { segments: ['4', '01', '01'], name: 'Ingresos Operacionales', type: AccountType.REVENUE, category: AccountCategory.OPERATING_REVENUE, nature: AccountNature.CREDIT, isPostable: false,
          children: [
            { segments: ['4', '01', '01', '001'], name: 'Venta de Bienes', type: AccountType.REVENUE, category: AccountCategory.OPERATING_REVENUE, nature: AccountNature.CREDIT, isPostable: true, isSystemAccount: true },
            { segments: ['4', '01', '01', '002'], name: 'Ingresos por Servicios', type: AccountType.REVENUE, category: AccountCategory.OPERATING_REVENUE, nature: AccountNature.CREDIT, isPostable: true },
          ]
        },
      ]
    },
    {
      segments: ['5'], name: 'Costos', type: AccountType.EXPENSE, category: AccountCategory.COST_OF_GOODS_SOLD, nature: AccountNature.DEBIT, isPostable: false,
      children: [
        { segments: ['5', '01', '01'], name: 'Costo de Ventas', type: AccountType.EXPENSE, category: AccountCategory.COST_OF_GOODS_SOLD, nature: AccountNature.DEBIT, isPostable: true, isSystemAccount: true },
      ]
    },
    {
      segments: ['6'], name: 'Gastos', type: AccountType.EXPENSE, category: AccountCategory.OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: false,
      children: [
        { segments: ['6', '01', '01'], name: 'Gastos Administrativos', type: AccountType.EXPENSE, category: AccountCategory.OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: false,
          children: [
            { segments: ['6', '01', '01', '001'], name: 'Sueldos y Salarios', type: AccountType.EXPENSE, category: AccountCategory.OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: true },
            { segments: ['6', '01', '01', '002'], name: 'Alquileres', type: AccountType.EXPENSE, category: AccountCategory.OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: true },
            { segments: ['6', '01', '01', '003'], name: 'Depreciación Gasto', type: AccountType.EXPENSE, category: AccountCategory.OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: true, isSystemAccount: true },
          ]
        },
        { segments: ['6', '01', '02'], name: 'Gastos Financieros', type: AccountType.EXPENSE, category: AccountCategory.NON_OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: false,
            children: [
                { segments: ['6', '01', '02', '001'], name: 'Comisiones Bancarias', type: AccountType.EXPENSE, category: AccountCategory.NON_OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: true },
            ]
        }
      ]
    },
  ],
  taxTemplates: [
    { name: 'ITBIS - 18% (Tasa General)', rate: 18.00, type: TaxType.PERCENTAGE },
    { name: 'ITBIS - 0% (Exento)', rate: 0.00, type: TaxType.PERCENTAGE },
    { name: 'ITBIS Reducido - 16%', rate: 16.00, type: TaxType.PERCENTAGE },
  ],
  ncfSequences: [
    { type: NcfType.B01, prefix: 'B01', startsAt: 1, endsAt: 99999999 },
    { type: NcfType.B02, prefix: 'B02', startsAt: 1, endsAt: 99999999 },
    { type: NcfType.B03, prefix: 'B03', startsAt: 1, endsAt: 99999999 },
    { type: NcfType.B04, prefix: 'B04', startsAt: 1, endsAt: 99999999 },
    { type: NcfType.B11, prefix: 'B11', startsAt: 1, endsAt: 99999999 },
    { type: NcfType.B15, prefix: 'B15', startsAt: 1, endsAt: 99999999 },
  ],
  reportDefinitions: {
    '606': {
      name: 'Formato 606 - Compras de Bienes y Servicios',
      format: 'TXT',
      template: `...`,
    },
    '607': {
      name: 'Formato 607 - Ventas de Bienes y Servicios',
      format: 'TXT',
      template: `...`,
    }
  },
  eInvoiceProviderConfig: {
    providerName: 'DGII_DO',
    isSandbox: true,
    apiUrl: 'https://ecf.dgii.gov.do/testecf/emision',
  }
};