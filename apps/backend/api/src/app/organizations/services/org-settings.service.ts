import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OrganizationSettings } from '../entities/organization-settings.entity';
import { BadRequestError } from '../../i18n/localized.exception';

@Injectable()
export class OrgSettingsService {
  constructor(
    @InjectRepository(OrganizationSettings)
    private readonly repo: Repository<OrganizationSettings>,
  ) {}

  async getForOrg(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<OrganizationSettings | null> {
    if (manager) {
      return manager
        .getRepository(OrganizationSettings)
        .findOne({ where: { organizationId } });
    }
    return this.repo.findOne({ where: { organizationId } });
  }

  async requireForOrg(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<OrganizationSettings> {
    const settings = await this.getForOrg(organizationId, manager);
    if (!settings) {
      throw new BadRequestError('shared.organization_settings_not_found');
    }
    return settings;
  }

  async getAccountingDefaults(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<{
    accountsReceivableId: string | null;
    accountsPayableId: string | null;
    salesRevenueId: string | null;
    serviceRevenueId: string | null;
    salesTaxId: string | null;
    purchaseTaxId: string | null;
    cashId: string | null;
    bankId: string | null;
    retainedEarningsAccountId: string | null;
    forexGainLossAccountId: string | null;
    openingBalanceEquityAccountId: string | null;
    inventoryId: string | null;
    costOfGoodsSoldId: string | null;
    salesDiscountsId: string | null;
    serviceChargePayableId: string | null;
    taxWithheldReceivableId: string | null;
    taxWithheldPayableId: string | null;
    exciseTaxPayableId: string | null;
    inventoryAdjustmentAccountId: string | null;
    customerAdvancesAccountId: string | null;
    depreciationExpenseAccountId: string | null;
    accumulatedDepreciationAccountId: string | null;
    inflationAdjustmentAccountId: string | null;
    baseCurrency: string;
  }> {
    const s = await this.requireForOrg(organizationId, manager);
    return {
      accountsReceivableId: s.defaultAccountsReceivableId,
      accountsPayableId: s.defaultAccountsPayableId,
      salesRevenueId: s.defaultSalesRevenueId,
      serviceRevenueId: s.defaultServiceRevenueId,
      salesTaxId: s.defaultSalesTaxId,
      purchaseTaxId: s.defaultPurchaseTaxId,
      cashId: s.defaultCashId,
      bankId: s.defaultBankId,
      retainedEarningsAccountId: s.defaultRetainedEarningsAccountId,
      forexGainLossAccountId: s.defaultForexGainLossAccountId,
      openingBalanceEquityAccountId: s.defaultOpeningBalanceEquityAccountId,
      inventoryId: s.defaultInventoryId,
      costOfGoodsSoldId: s.defaultCostOfGoodsSoldId,
      salesDiscountsId: s.defaultSalesDiscountsId,
      serviceChargePayableId: s.defaultServiceChargePayableId,
      taxWithheldReceivableId: s.defaultTaxWithheldReceivableId,
      taxWithheldPayableId: s.defaultTaxWithheldPayableId,
      exciseTaxPayableId: s.defaultExciseTaxPayableId,
      inventoryAdjustmentAccountId: s.defaultInventoryAdjustmentAccountId,
      customerAdvancesAccountId: s.defaultCustomerAdvancesAccountId,
      depreciationExpenseAccountId: s.defaultDepreciationExpenseAccountId,
      accumulatedDepreciationAccountId: s.defaultAccumulatedDepreciationAccountId,
      inflationAdjustmentAccountId: s.defaultInflationAdjustmentAccountId,
      baseCurrency: s.baseCurrency,
    };
  }

  async getPayrollDefaults(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<{
    salaryExpenseAccountId: string | null;
    employerContributionsExpenseAccountId: string | null;
    netPayableAccountId: string | null;
    afpPayableAccountId: string | null;
    sfsPayableAccountId: string | null;
    infotepPayableAccountId: string | null;
    payrollTaxWithholdingPayableAccountId: string | null;
    accountsPayableId: string | null;
    baseCurrency: string;
  }> {
    const s = await this.requireForOrg(organizationId, manager);
    return {
      salaryExpenseAccountId: s.defaultSalaryExpenseAccountId,
      employerContributionsExpenseAccountId: s.defaultEmployerContributionsExpenseAccountId,
      netPayableAccountId: s.defaultPayrollNetPayableAccountId,
      afpPayableAccountId: s.defaultAfpPayableAccountId,
      sfsPayableAccountId: s.defaultSfsPayableAccountId,
      infotepPayableAccountId: s.defaultInfotepPayableAccountId,
      payrollTaxWithholdingPayableAccountId: s.defaultPayrollTaxWithholdingPayableAccountId,
      accountsPayableId: s.defaultAccountsPayableId,
      baseCurrency: s.baseCurrency,
    };
  }

  async getTreasuryDefaults(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<{
    cashId: string | null;
    bankId: string | null;
    baseCurrency: string;
  }> {
    const s = await this.requireForOrg(organizationId, manager);
    return {
      cashId: s.defaultCashId,
      bankId: s.defaultBankId,
      baseCurrency: s.baseCurrency,
    };
  }

  async update(
    organizationId: string,
    partial: Partial<OrganizationSettings>,
    manager?: EntityManager,
  ): Promise<OrganizationSettings> {
    const repo = manager
      ? manager.getRepository(OrganizationSettings)
      : this.repo;

    let settings = await repo.findOne({ where: { organizationId } });
    if (!settings) {
      settings = repo.create({ organizationId, ...partial });
    } else {
      Object.assign(settings, partial);
    }
    return repo.save(settings);
  }
}
