import { ExchangeRateType } from '../../currencies/entities/exchange-rate.entity';
import { OrganizationSettings } from '../entities/organization-settings.entity';

/**
 * The organization's settings, by the section of «Configuración» that edits them (QA M-09).
 *
 * Eleven sections said «En desarrollo» while the settings row already held what most of them
 * describe — every default account the posting services read, the exchange-rate policy, the
 * taxpayer type, the archive retention — with no screen to change any of it. Each section names
 * exactly which columns it owns, so a section can never write another's: the API is the list
 * below, not "any column of the settings row".
 */

/** An account type the field must have, or `null` when either side of the P&L is legitimate. */
type ExpectedType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | null;

type AccountField = keyof OrganizationSettings & `default${string}`;

interface PolicyField<T> {
  /** Accepts the value as sent, or returns the catalogue key explaining the refusal. */
  validate(value: unknown): { ok: true; value: T } | { ok: false; key: string; params?: Record<string, unknown> };
}

export interface SettingsSection {
  /** Default accounts the posting services read, and the type each must have. */
  readonly accounts: Partial<Record<AccountField, ExpectedType>>;
  /** Other columns the section edits, each with its own rule. */
  readonly fields: Partial<Record<keyof OrganizationSettings, PolicyField<unknown>>>;
}

const enumField = <T extends string>(values: readonly T[], nullable = false): PolicyField<T | null> => ({
  validate: (value) =>
    (nullable && value === null) || values.includes(value as T)
      ? { ok: true, value: value as T | null }
      : { ok: false, key: 'organizations.settings.invalid_option', params: { options: values.join(', ') } },
});

const intField = (min: number, max: number): PolicyField<number> => ({
  validate: (value) =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max
      ? { ok: true, value: value as number }
      : { ok: false, key: 'organizations.settings.integer_between', params: { min, max } },
});

const fractionField = (min: number, max: number): PolicyField<number> => ({
  validate: (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
      ? { ok: true, value }
      : { ok: false, key: 'organizations.settings.number_between', params: { min, max } },
});

export const SETTINGS_SECTIONS = {
  accounting: {
    accounts: {
      defaultAccountsReceivableId: 'ASSET',
      defaultAccountsPayableId: 'LIABILITY',
      defaultSalesRevenueId: 'REVENUE',
      defaultServiceRevenueId: 'REVENUE',
      defaultSalesDiscountsId: 'REVENUE',
      defaultCashId: 'ASSET',
      defaultBankId: 'ASSET',
      defaultBankFeesAccountId: 'EXPENSE',
      defaultCustomerAdvancesAccountId: 'LIABILITY',
      defaultOpeningBalanceEquityAccountId: 'EQUITY',
      defaultDepreciationExpenseAccountId: 'EXPENSE',
      defaultAccumulatedDepreciationAccountId: 'ASSET',
      defaultInflationAdjustmentAccountId: null,
    },
    fields: { defaultPaymentTermDays: intField(0, 365) },
  },
  currencies: {
    accounts: { defaultForexGainLossAccountId: null },
    fields: {
      exchangeRateType: enumField(Object.values(ExchangeRateType)),
      fxRateMaxAgeDays: intField(0, 90),
      fxRateTolerance: fractionField(0, 0.25),
    },
  },
  taxes: {
    accounts: {
      defaultSalesTaxId: 'LIABILITY',
      defaultPurchaseTaxId: 'ASSET',
      defaultTaxWithheldReceivableId: 'ASSET',
      defaultTaxWithheldPayableId: 'LIABILITY',
      defaultExciseTaxPayableId: 'LIABILITY',
      defaultServiceChargePayableId: 'LIABILITY',
    },
    // Spelled out against the column's own type rather than imported from localization: the
    // compiler still rejects a value the column cannot hold.
    fields: {
      taxpayerType: enumField(
        ['INDIVIDUAL', 'COMPANY', 'WITHHOLDING_AGENT', 'GOVERNMENT', 'FOREIGN'] as const satisfies readonly `${NonNullable<OrganizationSettings['taxpayerType']>}`[],
        true,
      ),
    },
  },
  closing: {
    accounts: { defaultRetainedEarningsAccountId: 'EQUITY' },
    fields: { fiscalArchiveAfterYears: intField(5, 30) },
  },
  intercompany: {
    accounts: {
      defaultIntercompanyReceivableAccountId: 'ASSET',
      defaultIntercompanyPayableAccountId: 'LIABILITY',
    },
    fields: {},
  },
  inventory: {
    accounts: {
      defaultInventoryId: 'ASSET',
      defaultCostOfGoodsSoldId: 'EXPENSE',
      defaultInventoryAdjustmentAccountId: 'EXPENSE',
      defaultGoodsReceivedNotInvoicedAccountId: 'LIABILITY',
    },
    fields: {},
  },
} as const satisfies Record<string, SettingsSection>;

export type SettingsSectionId = keyof typeof SETTINGS_SECTIONS;

export function isSettingsSection(id: string): id is SettingsSectionId {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SECTIONS, id);
}
