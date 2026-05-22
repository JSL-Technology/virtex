
import { Injectable, Logger } from '@nestjs/common';
import { BaseFiscalStrategy } from '../fiscal-strategy.interface';

@Injectable()
export class USStrategy extends BaseFiscalStrategy {
  private readonly logger = new Logger(USStrategy.name);

  async validateTaxId(taxId: string): Promise<boolean> {
    // EIN validation: 9 digits, often 12-3456789
    // SSN validation: 9 digits, often 123-45-6789
    if (!taxId) return false;
    const clean = taxId.replace(/[^\d]/g, '');
    return clean.length === 9;
  }

  async getTaxIdDetails(taxId: string): Promise<any> {
    // US doesn't have a free public API for EIN lookups like DGII
    return {
      taxId,
      isValid: await this.validateTaxId(taxId)
    };
  }

  getConfig(): any {
    return {
      countryCode: 'US',
      name: 'United States',
      taxIdLabel: 'EIN/SSN',
      taxIdRegex: '^[\\d\\-]+$', // Changed from ^\d{9}$
      taxIdMask: '00-0000000',
      currency: 'USD'
    };
  }
}
