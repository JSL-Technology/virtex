
import { Injectable } from '@nestjs/common';
import { BaseFiscalStrategy } from './fiscal-strategy.interface';
import { FiscalRegion } from '../entities/fiscal-region.entity';

export class DbDrivenFiscalStrategy extends BaseFiscalStrategy {
  constructor(private readonly region: FiscalRegion) {
    super();
  }

  async validateTaxId(taxId: string): Promise<boolean> {
    const taxIdRegex = this.region.identityDocumentConfig?.types?.find(
      (t) => t.isCompany,
    )?.regex;
    if (taxIdRegex) {
      return new RegExp(taxIdRegex).test(taxId);
    }
    // Fallback to simple regex if present, otherwise allow all
    return true;
  }

  async getTaxIdDetails(taxId: string): Promise<any> {
    // DB Driven strategy typically doesn't have an external API connector unless configured
    // For now return null, or we could implement a generic connector if URL is in config
    return null;
  }

  getConfig(): any {
    const companyDoc = this.region.identityDocumentConfig?.types?.find(
      (t) => t.isCompany,
    );
    const taxIdRegex = companyDoc?.regex || '.*';

    return {
      countryCode: this.region.countryCode,
      name: this.region.name,
      currency: this.region.baseCurrency,
      locale: 'es-419', // Default, could be in DB
      phoneCode: '', // Not currently in FiscalRegion entity, could be added
      taxIdLabel: this.region.taxIdLabel || 'Tax ID',
      taxIdRegex: taxIdRegex,
      taxIdMask: '', // Could be added to entity
      fiscalRegionId: this.region.id,
      formSchema: {}, // Could be dynamic
    };
  }
}
