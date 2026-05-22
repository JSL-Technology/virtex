
import { Injectable, Logger } from '@nestjs/common';
import { BaseFiscalStrategy } from '../fiscal-strategy.interface';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class DominicanRepublicStrategy extends BaseFiscalStrategy {
  private readonly logger = new Logger(DominicanRepublicStrategy.name);

  constructor(private readonly httpService: HttpService) {
    super();
  }

  async validateTaxId(taxId: string): Promise<boolean> {
    if (!taxId) return false;

    // Sanitize input (remove non-digits)
    const str = taxId.replace(/[^\d]/g, '');

    // Check length (9 for RNC, 11 for Cedula)
    if (str.length !== 9 && str.length !== 11) return false;

    // RNC (9 digits)
    if (str.length === 9) {
      const weight = [7, 9, 8, 6, 5, 4, 3, 2];
      let sum = 0;
      for (let i = 0; i < 8; i++) {
        sum += parseInt(str.charAt(i)) * weight[i];
      }
      const remainder = sum % 11;
      let digit = 0;
      if (remainder === 0) digit = 2;
      else if (remainder === 1) digit = 1;
      else digit = 11 - remainder;

      return digit === parseInt(str.charAt(8));
    }

    // Cedula (11 digits)
    if (str.length === 11) {
      // Basic check for now or just trust the DGII API later if needed.
      // Implementing Modulo 10 (Luhn) for Cedula
      let sum = 0;
      const weight = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
      for (let i = 0; i < 10; i++) {
        let n = parseInt(str.charAt(i)) * weight[i];
        if (n >= 10) n = Math.floor(n / 10) + (n % 10);
        sum += n;
      }
      const digit = (10 - (sum % 10)) % 10;
      return digit === parseInt(str.charAt(10));
    }

    return false;
  }

  async getTaxIdDetails(taxId: string): Promise<any> {
    try {
      const url = `https://api.digital.gob.do/v3/rnc/${taxId}`;
      const { data } = await lastValueFrom(this.httpService.get(url));

      if (data) {
        return {
          taxId: data.rnc,
          legalName: data.name,
          status: data.status,
          industry: data.activity,
          isValid: true
        };
      }
      return null;
    } catch (error) {
        this.logger.error(`Error fetching DGII data for ${taxId}`, error);
        return null;
    }
  }

  getConfig(): any {
    return {
      countryCode: 'DO',
      name: 'República Dominicana',
      taxIdLabel: 'RNC',
      // Allow digits and hyphens.
      // ^[\d\-]+$ is simple. Or ^(\d{3}-?\d{5}-?\d{1})|(\d{3}-?\d{7}-?\d{1})$ for more structure but maybe too complex for simple regex engine in frontend if needed.
      taxIdRegex: '^[\\d\\-]+$',
      taxIdMask: '000-00000-0', // This is primarily for UI masking libraries if used
      currency: 'DOP'
    };
  }
}
