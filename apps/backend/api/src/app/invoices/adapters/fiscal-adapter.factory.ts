import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FiscalRangeService } from '../../einvoicing/services/fiscal-range.service';
import { knownMarket, marketFor } from '../../markets';
import { organizationFiscalIdentity } from '../../organizations/contracts/fiscal-identity.contract';
import { FiscalAdapter } from '../interfaces/fiscal-adapter.interface';
import { MarketFiscalAdapter } from './market-fiscal.adapter';

/**
 * The fiscal numbering of a tenant's market.
 *
 * There is one adapter, `MarketFiscalAdapter`, and the market it is given decides everything that
 * differs: where the number comes from, which type a document is, how the number is written. This
 * used to be a `switch` on the country code over nine adapters — the core naming every market it
 * served, and the next market a new `case`. Opening a market now touches its package only.
 */
@Injectable()
export class FiscalAdapterFactory {
  private readonly byMarket = new Map<string, MarketFiscalAdapter>();
  private readonly neutral: MarketFiscalAdapter;

  constructor(
    private readonly ranges: FiscalRangeService,
    private readonly dataSource: DataSource,
  ) {
    this.neutral = new MarketFiscalAdapter(marketFor(null), ranges);
  }

  /** Adapter for an organization, resolved inside the caller's transaction when one is given. */
  async getAdapter(organizationId: string, manager?: EntityManager): Promise<FiscalAdapter> {
    const organization = await organizationFiscalIdentity(manager ?? this.dataSource.manager, organizationId);
    return this.forCountry(organization?.country ?? null);
  }

  /** The market's numbering; a country the product is not sold in issues no fiscal number. */
  forCountry(countryCode: string | null | undefined): FiscalAdapter {
    const market = knownMarket(countryCode);
    if (!market) return this.neutral;
    let adapter = this.byMarket.get(market.code);
    if (!adapter) {
      adapter = new MarketFiscalAdapter(market, this.ranges);
      this.byMarket.set(market.code, adapter);
    }
    return adapter;
  }
}
