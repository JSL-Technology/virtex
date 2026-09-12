import { Injectable } from '@nestjs/common';
import { BadRequestError } from '../../i18n/localized.exception';
import { PayrollJurisdictionStrategy } from './jurisdiction-strategy.interface';
import { DominicanRepublicStrategy } from './dominican-republic.strategy';

/**
 * Selects the payroll rules for a country.
 *
 * The one place that knows which strategies exist. A run resolves its strategy here by country code;
 * everything downstream depends on the interface, not on the Dominican class. Registering a new
 * country is adding an entry to the map — no caller changes, which is the whole point of the
 * strategy split the audit asked for.
 */
@Injectable()
export class JurisdictionRegistry {
  private readonly strategies = new Map<string, PayrollJurisdictionStrategy>();

  constructor() {
    this.register(new DominicanRepublicStrategy());
  }

  register(strategy: PayrollJurisdictionStrategy): void {
    this.strategies.set(strategy.countryCode.toUpperCase(), strategy);
  }

  /** The strategy for a country, or a clear error naming the unsupported one. */
  forCountry(countryCode: string): PayrollJurisdictionStrategy {
    const strategy = this.strategies.get((countryCode ?? '').toUpperCase());
    if (!strategy) {
      throw new BadRequestError('PAYROLL.JURISDICCION_NO_SOPORTADA', { p1: countryCode });
    }
    return strategy;
  }

  supports(countryCode: string): boolean {
    return this.strategies.has((countryCode ?? '').toUpperCase());
  }
}
