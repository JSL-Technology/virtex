import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CountryConfig } from '../entities/country-config.entity';

@Injectable()
export class CountryService {
  constructor(
    @InjectRepository(CountryConfig)
    private readonly countryRepo: Repository<CountryConfig>,
  ) {}

  private configs: CountryConfig[] = [
    {
      code: 'do',
      name: 'República Dominicana',
      currencyCode: 'DOP',
      currencySymbol: 'RD$',
      locale: 'es-DO',
      phoneCode: '+1',
      formSchema: {
        taxId: {
          label: 'RNC / Cédula',
          pattern: '^[0-9]{9,11}$',
          errorMessage: 'El RNC debe tener 9 u 11 dígitos.',
          required: true
        },
        fields: [
            { name: 'itbis', label: 'ITBIS (%)', type: 'number', defaultValue: 18 }
        ]
      }
    },
    {
      code: 'us',
      name: 'United States',
      currencyCode: 'USD',
      currencySymbol: '$',
      locale: 'en-US',
      phoneCode: '+1',
      formSchema: {
        taxId: {
          label: 'EIN / SSN',
          pattern: '^[0-9]{9}$',
          errorMessage: 'EIN must be 9 digits.',
          required: true
        },
        fields: [
            { name: 'salesTax', label: 'Sales Tax (%)', type: 'number', defaultValue: 0 }
        ]
      }
    },
     {
      code: 'co',
      name: 'Colombia',
      currencyCode: 'COP',
      currencySymbol: '$',
      locale: 'es-CO',
      phoneCode: '+57',
      formSchema: {
        taxId: {
          label: 'NIT',
          pattern: '^[0-9]+$',
          errorMessage: 'El NIT solo puede contener números.',
          required: true
        },
        fields: []
      }
    }
  ];

  async findOne(code: string): Promise<CountryConfig> {
    // Try to find in DB first
    try {
        const fromDb = await this.countryRepo.findOne({ where: { code: code.toUpperCase() } });
        if (fromDb) return fromDb;
    } catch (e) {
        // DB might be down or not migrated, fallback to memory
    }

    const config = this.configs.find(c => c.code.toLowerCase() === code.toLowerCase());
    if (!config) {
        throw new NotFoundException(`Country ${code} not found`);
    }
    return config;
  }
}
