
import { Injectable } from '@nestjs/common';
import { CountryRegistrationStrategy } from './country-registration.strategy';
import { DoRegistrationStrategy } from './do-registration.strategy';
import { UsRegistrationStrategy } from './us-registration.strategy';

@Injectable()
export class RegistrationStrategyFactory {
  constructor(
    private readonly doStrategy: DoRegistrationStrategy,
    private readonly usStrategy: UsRegistrationStrategy
  ) {}

  getStrategy(countryCode: string): CountryRegistrationStrategy {
    const code = countryCode?.toUpperCase();
    switch (code) {
      case 'DO':
        return this.doStrategy;
      case 'US':
        return this.usStrategy;
      default:
        return this.usStrategy;
    }
  }
}
