
import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { FiscalRegion } from '../entities/fiscal-region.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { ChartOfAccountsService } from '../../chart-of-accounts/chart-of-accounts.service';
import { TaxesService } from '../../taxes/taxes.service';
import { panamaCoaTemplate } from '../templates/pa-coa.template';
import { panamaTaxTemplate } from '../templates/pa-taxes.template';
import { AccountTemplateDto } from '../entities/coa-template.entity';
import { usGaapCoaTemplate } from '../templates/us-gaap-coa.template';
import { FiscalStrategy } from '../drivers/fiscal-strategy.interface';
import { DominicanRepublicStrategy } from '../drivers/dominican-republic/dominican-republic.strategy';
import { GenericFiscalStrategy } from '../drivers/generic-fiscal.strategy';
import { USStrategy } from '../drivers/usa/usa.strategy';
import { DbDrivenFiscalStrategy } from '../drivers/db-driven-fiscal.strategy';
import { TaxTemplate } from '../entities/tax-template.entity';

@Injectable()
export class LocalizationService implements OnModuleInit {
  private readonly logger = new Logger(LocalizationService.name);
  private strategies: Map<string, FiscalStrategy> = new Map();

  constructor(
    @InjectRepository(FiscalRegion)
    private readonly fiscalRegionRepository: Repository<FiscalRegion>,
    @InjectRepository(TaxTemplate)
    private readonly taxTemplateRepository: Repository<TaxTemplate>,
    private readonly coaService: ChartOfAccountsService,
    private readonly taxesService: TaxesService,
    private readonly doStrategy: DominicanRepublicStrategy,
    private readonly usStrategy: USStrategy,
    private readonly genericStrategy: GenericFiscalStrategy,
  ) {
    // Inicialmente cargamos las estrategias hardcoded que tienen lógica especial
    this.strategies.set('DO', this.doStrategy);
    this.strategies.set('US', this.usStrategy);
    this.strategies.set('GENERIC', this.genericStrategy);
  }

  async onModuleInit() {
    await this.seedFiscalRegions();
    await this.loadStrategies();
  }

  /**
   * Carga dinámicamente estrategias para todos los países que están en la base de datos
   * pero que no tienen una estrategia hardcoded (clase específica).
   */
  private async loadStrategies() {
    const regions = await this.fiscalRegionRepository.find();
    for (const region of regions) {
      if (!this.strategies.has(region.countryCode)) {
        this.logger.log(
          `Registrando estrategia fiscal dinámica para: ${region.name} (${region.countryCode})`,
        );
        this.strategies.set(
          region.countryCode,
          new DbDrivenFiscalStrategy(region),
        );
      }
    }
  }

  getStrategy(countryCode: string): FiscalStrategy {
    const code = countryCode ? countryCode.toUpperCase() : 'GENERIC';
    return this.strategies.get(code) || this.strategies.get('GENERIC');
  }

  async findAllFiscalRegions(): Promise<FiscalRegion[]> {
    return this.fiscalRegionRepository.find({ order: { name: 'ASC' } });
  }

  async findById(id: string): Promise<FiscalRegion | null> {
    return this.fiscalRegionRepository.findOneBy({ id });
  }

  async findRegionByCountryCode(
    countryCode: string,
  ): Promise<FiscalRegion | null> {
    return this.fiscalRegionRepository.findOne({ where: { countryCode } });
  }

  private async seedFiscalRegions() {
    const regions = [
      {
        countryCode: 'DO',
        name: 'República Dominicana',
        baseCurrency: 'DOP',
        taxIdLabel: 'RNC',
        fiscalAuthorityName: 'DGII',
        provinceLabel: 'Provincia',
        postalCodeRegex: '\\d{5}',
        identityDocumentConfig: {
          types: [
            {
              code: 'RNC',
              label: 'RNC',
              regex: '^\\d{9,11}$',
              isCompany: true,
            },
            {
              code: 'CEDULA',
              label: 'Cédula',
              regex: '^\\d{11}$',
              isCompany: false,
            },
          ],
        },
        requiredFiscalReports: ['606', '607', '608', 'IT-1'],
        electronicInvoicingDriver: 'DGII_E-FACTURA',
        requiresElectronicInvoicing: true,
        dateFormat: 'dd/MM/yyyy',
      },
      {
        countryCode: 'US',
        name: 'United States',
        baseCurrency: 'USD',
        taxIdLabel: 'EIN',
        fiscalAuthorityName: 'IRS',
        provinceLabel: 'State',
        postalCodeRegex: '\\d{5}(-\\d{4})?',
        identityDocumentConfig: {
          types: [
            {
              code: 'EIN',
              label: 'EIN',
              regex: '^\\d{2}-\\d{7}$',
              isCompany: true,
            },
            {
              code: 'SSN',
              label: 'SSN',
              regex: '^\\d{3}-\\d{2}-\\d{4}$',
              isCompany: false,
            },
          ],
        },
        dateFormat: 'MM/dd/yyyy',
        thousandSeparator: ',',
        decimalSeparator: '.',
      },
      {
        countryCode: 'PA',
        name: 'Panamá',
        baseCurrency: 'PAB',
        taxIdLabel: 'RUC',
        fiscalAuthorityName: 'DGI',
        provinceLabel: 'Provincia',
        identityDocumentConfig: {
          types: [
            {
              code: 'RUC',
              label: 'RUC',
              regex: '^[0-9]+-[0-9]+-[0-9]+(-[0-9]+)?$',
              isCompany: true,
            },
          ],
        },
      },
      {
        countryCode: 'CO',
        name: 'Colombia',
        baseCurrency: 'COP',
        taxIdLabel: 'NIT',
        fiscalAuthorityName: 'DIAN',
        provinceLabel: 'Departamento',
        identityDocumentConfig: {
          types: [
            {
              code: 'NIT',
              label: 'NIT',
              regex: '^\\d{9,10}$',
              isCompany: true,
            },
          ],
        },
      },
      {
        countryCode: 'MX',
        name: 'México',
        baseCurrency: 'MXN',
        taxIdLabel: 'RFC',
        fiscalAuthorityName: 'SAT',
        provinceLabel: 'Estado',
        identityDocumentConfig: {
          types: [
            {
              code: 'RFC',
              label: 'RFC',
              regex: '^[A-Z&Ñ]{3,4}\\d{6}[A-V1-9][A-Z1-9][0-9A]$',
              isCompany: true,
            },
          ],
        },
      },
      {
        countryCode: 'CL',
        name: 'Chile',
        baseCurrency: 'CLP',
        taxIdLabel: 'RUT',
        fiscalAuthorityName: 'SII',
        provinceLabel: 'Región',
        identityDocumentConfig: {
          types: [
            {
              code: 'RUT',
              label: 'RUT',
              regex: '^\\d{7,8}-[0-9Kk]$',
              isCompany: true,
            },
          ],
        },
      },
    ];

    for (const regionData of regions) {
      const regionExists = await this.fiscalRegionRepository.findOne({
        where: { countryCode: regionData.countryCode },
      });

      if (!regionExists) {
        this.logger.log(
          `Sembrando región fiscal para ${regionData.name} (${regionData.countryCode})...`,
        );
        await this.fiscalRegionRepository.save(regionData as any);
      } else {
        // Actualizar datos existentes
        await this.fiscalRegionRepository.save({
          ...regionExists,
          ...regionData,
        } as any);
      }
    }

    // Seed Taxes for DO if not exist
    const doRegion = await this.fiscalRegionRepository.findOneBy({
      countryCode: 'DO',
    });
    if (doRegion) {
      const itbis = await this.taxTemplateRepository.findOneBy({
        countryCode: 'DO',
        name: 'ITBIS 18%',
      });
      if (!itbis) {
        const newTax = await this.taxTemplateRepository.save({
          countryCode: 'DO',
          name: 'ITBIS 18%',
          rate: 18,
          type: 'VAT',
        });
        // Link to region
        doRegion.defaultTaxes = [newTax];
        await this.fiscalRegionRepository.save(doRegion);
      }
    }
  }

  async applyFiscalPackage(
    organization: Organization,
    manager?: EntityManager,
  ) {
    if (!organization.fiscalRegionId) {
      this.logger.warn(
        `La organización ${organization.id} no tiene una región fiscal asignada. Omitiendo la aplicación del paquete fiscal.`,
      );
      return;
    }

    const regionRepo = manager
      ? manager.getRepository(FiscalRegion)
      : this.fiscalRegionRepository;
    const region = await regionRepo.findOne({
      where: { id: organization.fiscalRegionId },
      relations: ['defaultTaxes'],
    });

    if (!region) {
      throw new NotFoundException(
        `Región fiscal con ID "${organization.fiscalRegionId}" no encontrada.`,
      );
    }

    this.logger.log(
      `Aplicando paquete fiscal de ${region.name} para la organización ${organization.id}`,
    );

    // Apply Default Taxes from Relationship
    if (region.defaultTaxes && region.defaultTaxes.length > 0) {
      for (const template of region.defaultTaxes) {
        await this.taxesService.create(
          {
            name: template.name,
            rate: template.rate,
            type: template.type as any,
            code: template.name.toUpperCase().replace(/\s+/g, '_'),
            description: `Impuesto por defecto ${template.name}`,
          },
          organization.id,
          manager,
        );
      }
    }

    switch (region.countryCode) {
      case 'PA':
        await this.applyPanamaPackage(organization.id, manager);
        break;
      case 'US':
        await this.applyGenericCoaTemplate(
          organization.id,
          usGaapCoaTemplate.accounts,
          manager,
        );
        break;
      case 'DO':
        await this.applyGenericCoaTemplate(
          organization.id,
          usGaapCoaTemplate.accounts,
          manager,
        );
        break;
      default:
        // Para países con estrategia dinámica pero sin paquete contable específico, usamos el genérico
        this.logger.log(
          `Usando paquete contable genérico para ${region.countryCode}`,
        );
        await this.applyGenericCoaTemplate(
          organization.id,
          usGaapCoaTemplate.accounts,
          manager,
        );
    }
  }

  private async applyPanamaPackage(
    organizationId: string,
    manager?: EntityManager,
  ) {
    this.logger.log(
      `Aplicando impuestos de Panamá para la organización ${organizationId}...`,
    );
    for (const tax of panamaTaxTemplate.taxes) {
      await this.taxesService.create(tax, organizationId, manager);
    }
  }

  private async applyGenericCoaTemplate(
    organizationId: string,
    accounts: AccountTemplateDto[],
    manager?: EntityManager,
  ) {
    this.logger.log(
      `Aplicando plantilla de plan de cuentas para la organización ${organizationId}...`,
    );
    for (const account of accounts) {
      await this.createAccountFromTemplate(
        account,
        organizationId,
        null,
        manager,
      );
    }
  }

  private async createAccountFromTemplate(
    accountDto: AccountTemplateDto,
    organizationId: string,
    parentId: string | null,
    manager?: EntityManager,
  ) {
    const { children, ...createAccountDto } = accountDto;

    const createdAccount = await this.coaService.create(
      {
        ...createAccountDto,
        parentId,
      },
      organizationId,
      manager,
    );

    if (children && children.length > 0) {
      for (const child of children) {
        await this.createAccountFromTemplate(
          child,
          organizationId,
          createdAccount.id,
          manager,
        );
      }
    }
  }
}
