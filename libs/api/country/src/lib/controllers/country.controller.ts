import { Controller, Get, Param } from '@nestjs/common';
import { CountryService } from '../services/country.service';
import { CountryConfig } from '../entities/country-config.entity';

@Controller('countries')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get(':code')
  async getCountryConfig(@Param('code') code: string): Promise<CountryConfig> {
    return this.countryService.findOne(code);
  }
}
