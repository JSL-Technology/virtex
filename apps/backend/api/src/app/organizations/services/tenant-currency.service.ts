import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DataSource, Repository } from 'typeorm';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { OrganizationSettings } from '../entities/organization-settings.entity';
import { TenantCurrencyPort } from '../../i18n/ports/tenant-currency.port';
import { RegionalFormat, normaliseRegionalFormat } from '@virteex/shared/types';

/**
 * The tenant's functional currency for the session's locale context (QA A-12).
 *
 * Asked on every response that carries a user, so it is cached; changing the base currency in
 * the settings evicts the entry (`OrgSettingsService.update`).
 */
@Injectable()
export class TenantCurrencyService extends TenantCurrencyPort {
  private readonly logger = new Logger(TenantCurrencyService.name);

  static readonly TTL_MS = 5 * 60_000;

  static key(organizationId: string): string {
    return `functional_currency:${organizationId}`;
  }

  static formatKey(organizationId: string): string {
    return `regional_format:${organizationId}`;
  }

  constructor(
    @InjectRepository(OrganizationSettings)
    private readonly repo: Repository<OrganizationSettings>,
    @Optional() @Inject(CACHE_MANAGER) private readonly cache?: Cache,
    @Optional() private readonly dataSource?: DataSource,
  ) {
    super();
  }

  async functionalCurrency(organizationId: string): Promise<string | null> {
    const key = TenantCurrencyService.key(organizationId);
    try {
      const cached = await this.cache?.get<string>(key);
      if (typeof cached === 'string' && cached) return cached;
    } catch (error) {
      this.logger.warn(`Functional currency cache read failed: ${(error as Error).message}`);
    }

    // Read as the tenant: the settings row is under row-level security, and this runs while the
    // response is being written, outside any tenant transaction.
    const read = () => this.repo.findOne({ where: { organizationId }, select: ['id', 'baseCurrency'] });
    const settings = this.dataSource ? await runAsTenantJob(this.dataSource, organizationId, read) : await read();
    const currency = settings?.baseCurrency?.toUpperCase() ?? null;
    if (currency) {
      await this.cache?.set(key, currency, TenantCurrencyService.TTL_MS).catch(() => undefined);
    }
    return currency;
  }

  /**
   * The company's regional format, cleaned. Cached like the currency; saving it evicts the entry
   * (`RegionalFormatController`). An empty object is cached too — «nothing decided» is the common
   * answer and the one most worth not asking the database for.
   */
  async regionalFormat(organizationId: string): Promise<RegionalFormat | null> {
    const key = TenantCurrencyService.formatKey(organizationId);
    try {
      const cached = await this.cache?.get<RegionalFormat>(key);
      if (cached && typeof cached === 'object') return Object.keys(cached).length ? cached : null;
    } catch (error) {
      this.logger.warn(`Regional format cache read failed: ${(error as Error).message}`);
    }
    const read = () => this.repo.findOne({ where: { organizationId }, select: ['id', 'regionalFormat'] });
    const settings = this.dataSource ? await runAsTenantJob(this.dataSource, organizationId, read) : await read();
    const format = normaliseRegionalFormat(settings?.regionalFormat);
    await this.cache?.set(key, format, TenantCurrencyService.TTL_MS).catch(() => undefined);
    return Object.keys(format).length ? format : null;
  }
}
