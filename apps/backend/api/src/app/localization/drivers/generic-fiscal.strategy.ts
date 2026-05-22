
import { Injectable } from '@nestjs/common';
import { BaseFiscalStrategy } from './fiscal-strategy.interface';

@Injectable()
export class GenericFiscalStrategy extends BaseFiscalStrategy {

  async validateTaxId(taxId: string): Promise<boolean> {
    return true; // Generic always accepts
  }

  async getTaxIdDetails(taxId: string): Promise<any> {
    return null; // No external lookup
  }

  getConfig(): any {
    return {
      countryCode: 'GENERIC',
      taxIdLabel: 'Tax ID',
      taxIdRegex: '.*',
      taxIdMask: '',
      currency: 'USD'
    };
  }
}
