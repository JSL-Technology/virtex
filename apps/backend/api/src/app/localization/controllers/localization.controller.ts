
import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { LocalizationService } from '../services/localization.service';
import { Organization } from '../organizations/entities/organization.entity';
import { FiscalRegion } from '../entities/fiscal-region.entity';

@Controller('localization')
export class LocalizationController {
    constructor(private readonly localizationService: LocalizationService) {}

    @Get('fiscal-regions')
    async getFiscalRegions(): Promise<FiscalRegion[]> {
        return this.localizationService.findAllFiscalRegions();
    }

    @Get('config/:countryCode')
    async getConfig(@Param('countryCode') countryCode: string) {
        const strategy = this.localizationService.getStrategy(countryCode);
        const config = strategy.getConfig();

        // Find the fiscal region ID for this country
        const region = await this.localizationService.findRegionByCountryCode(config.countryCode);
        if (region) {
            config['fiscalRegionId'] = region.id;
        }

        return config;
    }

    @Get('lookup/:taxId')
    async lookupTaxId(@Param('taxId') taxId: string, @Query('country') country: string) {
        const strategy = this.localizationService.getStrategy(country);
        return strategy.getTaxIdDetails(taxId);
    }

    @Post('apply-package/:organizationId')
    async applyPackage(@Param('organizationId') organizationId: string): Promise<{ message: string }> {
        // This endpoint would normally be called by the worker/queue, but for testing we expose it
        // The service logic handles fetching the organization and region
        return { message: 'Use internal service call for application.' };
    }
}
