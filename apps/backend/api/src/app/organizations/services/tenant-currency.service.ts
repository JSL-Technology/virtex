import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DataSource, Repository } from 'typeorm';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { OrganizationSettings } from '../entities/organization-settings.entity';
import { TenantCurrencyPort } from '../../i18n/ports/tenant-currency.port';

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
}
