import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { OrganizationSettings } from '../entities/organization-settings.entity';
import { Organization } from '../entities/organization.entity';
import { BadRequestError } from '../../i18n/localized.exception';
import { MfaPolicyPort } from '../../auth/ports/mfa-policy.port';
import { TenantCurrencyService } from './tenant-currency.service';

@Injectable()
export class OrgSettingsService extends MfaPolicyPort {
  private readonly logger = new Logger(OrgSettingsService.name);

  /** How long a tenant's MFA policy is served from the cache. Changing it evicts the entry. */
  private static readonly MFA_POLICY_TTL_MS = 60_000;

  constructor(
    @InjectRepository(OrganizationSettings)
    private readonly repo: Repository<OrganizationSettings>,
    // Optional only so the many integration suites that build this service by hand for its
    // accounting defaults keep compiling; the application always injects both.
    @Optional() @Inject(CACHE_MANAGER) private readonly cache?: Cache,
    @Optional() private readonly dataSource?: DataSource,
  ) {
    super();
  }

  private static mfaPolicyKey(organizationId: string): string {
    return `mfa_policy:${organizationId}`;
  }

  /**
   * Whether this tenant requires a second factor of every member.
   *
   * Implements {@link MfaPolicyPort} so `auth` can ask without importing this module. A tenant
   * with no settings row has not turned anything on, so the answer is no — the safe reading for a
   * policy whose default is off.
   */
  async requiresMfa(organizationId: string): Promise<boolean> {
    const key = OrgSettingsService.mfaPolicyKey(organizationId);
    try {
      const cached = await this.cache?.get<boolean>(key);
      if (typeof cached === 'boolean') return cached;
    } catch (error) {
      this.logger.warn(`MFA policy cache read failed: ${(error as Error).message}`);
    }

    // Read AS the tenant. `organization_settings` carries the tenant policy, and this is asked by
    // `MfaEnrolmentGuard` before the request's tenant connection exists — and at sign-in, before
    // there is a tenant at all. Without a context the policy hid the row, the answer was "not
    // required", and connected as `virtex_app` the organization's MFA requirement was never
    // enforced for anyone. A database error propagates: the guard treats it as "required".
    const read = () =>
      this.repo.findOne({ where: { organizationId }, select: ['id', 'requireMfa'] });
    const settings = this.dataSource
      ? await runAsTenantJob(this.dataSource, organizationId, read)
      : await read();
    const required = settings?.requireMfa ?? false;

    try {
      await this.cache?.set(key, required, OrgSettingsService.MFA_POLICY_TTL_MS);
    } catch (error) {
      this.logger.warn(`MFA policy cache write failed: ${(error as Error).message}`);
    }
    return required;
  }

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

  /**
   * How the company appears on the documents it e-mails: its chosen sender name, or its commercial
   * or legal name; its chosen reply address, or its e-mail on file; and the blind copy, if any.
   * `configured` carries the stored values alone, for the settings form.
   */
  async mailIdentity(organizationId: string): Promise<{
    senderName: string;
    replyTo: string | null;
    copyTo: string | null;
    configured: { senderName: string | null; replyTo: string | null; copyTo: string | null };
    defaults: { senderName: string; replyTo: string | null };
  }> {
    const [settings, organization] = await Promise.all([
      this.repo.findOne({ where: { organizationId } }),
      this.repo.manager.findOne(Organization, { where: { id: organizationId } }),
    ]);
    const defaults = {
      senderName: organization?.commercialName?.trim() || organization?.legalName || '',
      replyTo: organization?.email?.trim() || null,
    };
    const configured = {
      senderName: settings?.mailSenderName ?? null,
      replyTo: settings?.mailReplyTo ?? null,
      copyTo: settings?.mailCopyTo ?? null,
    };
    return {
      senderName: configured.senderName || defaults.senderName,
      replyTo: configured.replyTo || defaults.replyTo,
      copyTo: configured.copyTo,
      configured,
      defaults,
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
    const saved = await repo.save(settings);
    if (partial.requireMfa !== undefined) {
      // The next request of every member must see the new policy, not a cached one.
      await this.cache?.del(OrgSettingsService.mfaPolicyKey(organizationId)).catch(() => undefined);
    }
    if (partial.baseCurrency !== undefined) {
      // Every session must format in the new currency from its next response on.
      await this.cache?.del(TenantCurrencyService.key(organizationId)).catch(() => undefined);
    }
    return saved;
  }
}
