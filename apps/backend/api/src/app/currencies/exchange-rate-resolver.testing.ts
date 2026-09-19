import { DataSource } from 'typeorm';
import { ExchangeRateResolver } from './exchange-rate-resolver.service';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';

/**
 * Build an {@link ExchangeRateResolver} for an integration spec from a raw DataSource.
 *
 * The resolver depends on {@link OrgSettingsService} — it reads the tenant's rate-source preference
 * before resolving a rate. Every DB-backed spec was constructing the resolver by hand with just the
 * DataSource, so when the constructor gained the second dependency ~two dozen specs stopped
 * compiling at once. Routing them through one factory means the wiring lives in a single place and
 * the next dependency added to the resolver is a one-line change here, not a suite-wide break.
 */
export function testExchangeRateResolver(dataSource: DataSource): ExchangeRateResolver {
  return new ExchangeRateResolver(
    dataSource,
    new OrgSettingsService(dataSource.getRepository(OrganizationSettings)),
  );
}
