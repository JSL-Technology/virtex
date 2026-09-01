
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { FiscalRegion } from '../entities/fiscal-region.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { ChartOfAccountsService } from '../../chart-of-accounts/chart-of-accounts.service';
import { TaxesService } from '../../taxes/taxes.service';
import { AccountTemplateDto } from '../entities/coa-template.entity';
import { FiscalStrategy } from '../drivers/fiscal-strategy.interface';
import { DominicanRepublicStrategy } from '../drivers/dominican-republic/dominican-republic.strategy';
import { GenericFiscalStrategy } from '../drivers/generic-fiscal.strategy';
import { USStrategy } from '../drivers/usa/usa.strategy';
import { DbDrivenFiscalStrategy } from '../drivers/db-driven-fiscal.strategy';
import {
  COUNTRY_FISCAL_PROFILES,
  CountryFiscalProfile,
  findCountryProfile,
} from '../fiscal/country-profiles';
import { taxpayerKindAffectsValidation, validateTaxId } from '../fiscal/tax-id-validators';
import { PublicCountryConfig, TaxIdLookupResult } from '../fiscal/public-country-config';
import { findTaxScheme } from '../fiscal/country-tax-schemes';
import { TenantBookkeepingProvisioner } from '../../shared/provisioning/tenant-bookkeeping.provisioner';
import {
  STATUTORY_PLAN_REQUIRED,
  buildCountryCoaTemplate,
  requiresStatutoryPlanImport,
} from '../fiscal/coa-builder';
import { InternalServerError, NotFoundError } from '../../i18n/localized.exception';
import { fiscalLabelKey } from '../fiscal/fiscal-label-keys';
import { I18nService } from '../../i18n/i18n.service';
import { currentLanguage } from '../../i18n/request-locale';

/** Fallback when a country profile carries no currency; every shipped profile does. */
const DEFAULT_BASE_CURRENCY = 'USD';

@Injectable()
export class LocalizationService implements OnModuleInit {
  private readonly logger = new Logger(LocalizationService.name);
  private strategies: Map<string, FiscalStrategy> = new Map();

  constructor(
    @InjectRepository(FiscalRegion)
    private readonly fiscalRegionRepository: Repository<FiscalRegion>,
    private readonly coaService: ChartOfAccountsService,
    private readonly taxesService: TaxesService,
    private readonly doStrategy: DominicanRepublicStrategy,
    private readonly usStrategy: USStrategy,
    private readonly genericStrategy: GenericFiscalStrategy,
    private readonly bookkeeping: TenantBookkeepingProvisioner,
    private readonly i18n: I18nService,
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

  /**
   * `getStrategy(countryCode)` used to live here, returning the 'GENERIC' strategy for any country
   * it did not recognise — and that strategy's `validateTaxId` was `return true`. It was the
   * fallback the DTO validator, the registration factory and the tax-id lookup all reached, so an
   * unsupported country validated everything and nothing. It has no callers left: validation goes
   * through `tax-id-validators.ts`, which returns false for a country it has no algorithm for.
   *
   * `this.strategies` survives for one purpose: reaching a country's registry in `lookupTaxId`,
   * looked up by exact country code with no fallback.
   */

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

  /**
   * Bring `fiscal_regions` into agreement with the country profiles.
   *
   * This used to be a hardcoded array of six countries living inside this method, while the signup
   * form offered eight and `libs/api/country` listed three others again. A country present in the
   * form but absent here produced no fiscal region id, so the tenant was created with no chart of
   * accounts, no taxes and no fiscal identity — and the signup still returned success.
   *
   * `COUNTRY_FISCAL_PROFILES` is now the single authority; this method projects it onto the table.
   * It runs on every boot and is idempotent, so opening a market is a code change that deploys
   * itself rather than a manual insert somebody has to remember in every environment.
   */
  private async seedFiscalRegions() {
    for (const profile of COUNTRY_FISCAL_PROFILES) {
      const row = this.regionRowFor(profile);
      const existing = await this.fiscalRegionRepository.findOne({
        where: { countryCode: profile.countryCode },
      });

      if (existing) {
        await this.fiscalRegionRepository.save({ ...existing, ...row });
      } else {
        this.logger.log(`Sembrando región fiscal ${profile.name} (${profile.countryCode})`);
        await this.fiscalRegionRepository.save(
          this.fiscalRegionRepository.create(row),
        );
      }
    }

  }

  /** Project a profile onto the columns of `fiscal_regions`. */
  private regionRowFor(profile: CountryFiscalProfile): Partial<FiscalRegion> {
    const documentTypes = [
      {
        code: profile.taxId.label.replace(/[^A-Za-z]/g, '').toUpperCase() || 'TAXID',
        label: profile.taxId.label,
        regex: profile.taxId.pattern,
        isCompany: true,
      },
    ];

    if (profile.individualDocument) {
      documentTypes.push({
        code: profile.individualDocument.code,
        label: profile.individualDocument.label,
        regex: profile.individualDocument.pattern,
        isCompany: false,
      });
    }

    return {
      countryCode: profile.countryCode,
      name: profile.name,
      baseCurrency: profile.currency,
      taxIdLabel: profile.taxId.label,
      fiscalAuthorityName: profile.fiscalAuthority,
      provinceLabel: profile.address.divisionLabel,
      postalCodeRegex: profile.address.postalCodePattern ?? null,
      requiresElectronicInvoicing: profile.electronicInvoicing.required,
      electronicInvoicingDriver: profile.electronicInvoicing.regime,
      requiredFiscalReports: profile.requiredFiscalReports ?? [],
      identityDocumentConfig: { types: documentTypes },
      dateFormat: profile.dateFormat,
      thousandSeparator: profile.thousandSeparator,
      decimalSeparator: profile.decimalSeparator,
    } as Partial<FiscalRegion>;
  }

  /**
   * The configuration the signup form needs to render one country's fiscal fields.
   *
   * Unlike the strategy-derived config it replaces, an unknown country is an error rather than a
   * silent fall-through to a "generic" profile that accepted any string as a tax id. If a country
   * is not modelled, the honest answer is that it cannot be registered yet.
   */
  async getPublicCountryConfig(countryCode: string): Promise<PublicCountryConfig> {
    const profile = findCountryProfile(countryCode);
    if (!profile) {
      throw new NotFoundError('LOCALIZATION.PAIS_NO_ESTA_DISPONIBLE_REGISTRO_TODAVIA', { countryCode });
    }

    const region = await this.findRegionByCountryCode(profile.countryCode);
    if (!region) {
      // Seeding runs at boot from the same list, so this means the boot seed failed. Surfacing it
      // is better than handing the form a config whose fiscalRegionId is missing — that is exactly
      // how tenants used to end up with no chart of accounts.
      this.logger.error(
        `No existe fiscal_region para ${profile.countryCode} pese a estar en COUNTRY_FISCAL_PROFILES`,
      );
      throw new NotFoundError('LOCALIZATION.CONFIGURACION_FISCAL_NO_ESTA_DISPONIBLE', { countryCode: profile.countryCode });
    }

    // Every human-readable label goes out in the language of the request. The signup form used to
    // render these raw, so a Spanish-speaking founder registering in the United States met
    // 'State' and 'ZIP code', and an English-speaking one registering in the Dominican Republic
    // met 'Tipo de ingreso' and a paragraph about the DGII. See `fiscal-label-keys.ts` for which
    // labels are translated and which stay in the country's own words.
    const t = (label: string): string => {
      const key = fiscalLabelKey(label);
      return key ? this.i18n.translate(key, currentLanguage()) : label;
    };

    return {
      countryCode: profile.countryCode,
      name: profile.name,
      currency: profile.currency,
      locale: profile.locale,
      phoneCode: `+${profile.callingCode}`,
      fiscalAuthority: profile.fiscalAuthority,
      taxIdLabel: profile.taxId.label,
      taxIdExample: profile.taxId.example,
      taxIdPattern: profile.taxId.pattern,
      taxIdHasCheckDigit: profile.taxId.hasCheckDigit,
      individualDocument: profile.individualDocument ?? null,
      address: {
        ...profile.address,
        divisionLabel: t(profile.address.divisionLabel),
        postalCodeLabel: t(profile.address.postalCodeLabel),
      },
      electronicInvoicing: profile.electronicInvoicing,
      marketStatus: profile.marketStatus,
      taxpayerKindRequired: taxpayerKindAffectsValidation(profile.countryCode),
      fiscalFields: (profile.fiscalFields ?? []).map((field) => ({
        ...field,
        label: t(field.label),
        help: field.help ? t(field.help) : field.help,
        options: field.options?.map((option) => ({ ...option, label: t(option.label) })),
      })),
      dateFormat: profile.dateFormat,
      thousandSeparator: profile.thousandSeparator,
      decimalSeparator: profile.decimalSeparator,
      fiscalRegionId: region.id,
    };
  }

  /** Every country the product can actually onboard, for the signup country selector. */
  getSupportedCountries(): Array<Pick<CountryFiscalProfile, 'countryCode' | 'name' | 'currency' | 'callingCode'>> {
    return COUNTRY_FISCAL_PROFILES.map(({ countryCode, name, currency, callingCode }) => ({
      countryCode,
      name,
      currency,
      callingCode,
    }));
  }

  /**
   * Arithmetic validation of a fiscal identifier. Total, synchronous, and never network-bound.
   *
   * This is the check registration must not be able to skip. It is deliberately separate from
   * {@link lookupTaxId}: a check digit is verifiable offline and always available, whereas a
   * registry lookup depends on a third party being up.
   */
  isValidTaxId(countryCode: string, taxId: string): boolean {
    return validateTaxId(countryCode, taxId);
  }

  isSupportedCountry(countryCode: string): boolean {
    return Boolean(findCountryProfile(countryCode));
  }

  /**
   * Resolve a tax id against the country's registry, to pre-fill the legal name at signup.
   *
   * The identifier is validated arithmetically FIRST. That ordering is the point: the endpoint is
   * public, it reaches somebody else's government API, and forwarding unvalidated input to it is
   * how a platform spends a third party's rate limit and its own standing with them. A wrong check
   * digit cannot be a registered taxpayer, so it never needs to leave this process.
   *
   * A registry that is unreachable returns `valid: true, found: false` — not an error. The check
   * digit is authoritative for accepting the identifier; the lookup only saves typing.
   */
  async lookupTaxId(countryCode: string, taxId: string): Promise<TaxIdLookupResult> {
    const profile = findCountryProfile(countryCode);
    if (!profile) {
      throw new NotFoundError('LOCALIZATION.PAIS_NO_ESTA_DISPONIBLE_REGISTRO_TODAVIA', { countryCode });
    }

    if (!validateTaxId(profile.countryCode, taxId)) {
      return {
        countryCode: profile.countryCode,
        taxId,
        valid: false,
        found: false,
        legalName: null,
        status: null,
      };
    }

    const strategy = this.strategies.get(profile.countryCode);
    if (!strategy) {
      return {
        countryCode: profile.countryCode,
        taxId,
        valid: true,
        found: false,
        legalName: null,
        status: null,
      };
    }

    try {
      const details = await strategy.getTaxIdDetails(taxId);
      if (!details?.legalName) {
        return {
          countryCode: profile.countryCode,
          taxId,
          valid: true,
          found: false,
          legalName: null,
          status: null,
        };
      }

      return {
        countryCode: profile.countryCode,
        taxId,
        valid: true,
        found: true,
        legalName: details.legalName,
        status: details.status ?? null,
      };
    } catch (error) {
      this.logger.warn(
        `Consulta al registro fiscal de ${profile.countryCode} falló: ${(error as Error).message}`,
      );
      return {
        countryCode: profile.countryCode,
        taxId,
        valid: true,
        found: false,
        legalName: null,
        status: null,
      };
    }
  }

  /**
   * Give a newly created tenant its chart of accounts and its default taxes.
   *
   * Three things were wrong here and all three were silent:
   *
   *   1. An organization with no `fiscalRegionId` logged a warning and returned, leaving a tenant
   *      with an empty ledger. Registration now always resolves a region, so this is a hard error.
   *   2. Every country except Panama got `usGaapCoaTemplate` — fifteen accounts, in English, with
   *      no account for the local VAT. A Dominican tenant had nowhere to post ITBIS.
   *   3. The Dominican default tax was created with `type: 'VAT'`, and `taxes.type` is an enum
   *      accepting only `Porcentaje` and `Fijo`. The insert raised
   *      `invalid input value for enum taxes_type_enum: "VAT"` and rolled back the transaction the
   *      registration ran in.
   */
  async applyFiscalPackage(organization: Organization, manager?: EntityManager) {
    if (!organization.fiscalRegionId) {
      throw new InternalServerError('LOCALIZATION.ORGANIZACION_NO_TIENE_REGION_FISCAL_NO_PUEDE', { id: organization.id });
    }

    const regionRepo = manager
      ? manager.getRepository(FiscalRegion)
      : this.fiscalRegionRepository;
    const region = await regionRepo.findOne({
      where: { id: organization.fiscalRegionId },
    });

    if (!region) {
      throw new NotFoundError('LOCALIZATION.REGION_FISCAL_ID_NO_ENCONTRADA', { fiscalRegionId: organization.fiscalRegionId });
    }

    this.logger.log(
      `Aplicando paquete fiscal de ${region.name} a la organización ${organization.id}`,
    );

    await this.applyCountryTaxes(region.countryCode, organization.id, manager);
    await this.applyCountryCoa(region.countryCode, organization.id, manager);

    // A chart of accounts and a tax list are not enough to record a transaction. The tenant also
    // needs its accounting settings, a ledger, journals, document sequences and open periods —
    // none of which existed for any tenant, which is why the first invoice always failed. The
    // provisioner runs in this same transaction, so a tenant is either able to keep books or is
    // not created at all.
    const baseCurrency =
      findCountryProfile(region.countryCode)?.currency ?? DEFAULT_BASE_CURRENCY;
    await this.bookkeeping.provision(
      organization,
      baseCurrency,
      manager ?? this.fiscalRegionRepository.manager,
    );
  }

  /**
   * Seed the country's consumption taxes.
   *
   * `computation` is what goes into `taxes.type` — the column is an enum of Porcentaje/Fijo. The
   * regime (VAT, sales tax) is descriptive and deliberately not written there; conflating the two
   * is what produced the enum error this replaces.
   */
  private async applyCountryTaxes(
    countryCode: string,
    organizationId: string,
    manager?: EntityManager,
  ) {
    const scheme = findTaxScheme(countryCode);

    if (!scheme) {
      throw new InternalServerError('LOCALIZATION.NO_HAY_ESQUEMA_IMPUESTOS_DEFINIDO', { countryCode });
    }

    if (scheme.configurationRequired) {
      // Not an error: these are the markets whose tax base is sub-national or regime-dependent, so
      // there is no correct national rate to seed. The tenant configures it during onboarding.
      this.logger.log(
        `${countryCode} requiere configuración de impuestos por parte del contribuyente: ${scheme.configurationNote}`,
      );
      return;
    }

    for (const tax of scheme.taxes) {
      await this.taxesService.create(
        {
          name: tax.name,
          rate: tax.rate,
          type: tax.computation,
          countryCode,
        },
        organizationId,
        manager,
      );
    }
  }

  private async applyCountryCoa(
    countryCode: string,
    organizationId: string,
    manager?: EntityManager,
  ) {
    if (requiresStatutoryPlanImport(countryCode)) {
      this.logger.log(
        `${countryCode}: ${STATUTORY_PLAN_REQUIRED[countryCode]} Se aplica el plan base NIIF entretanto.`,
      );
    }

    const accounts = buildCountryCoaTemplate(countryCode);
    for (const account of accounts) {
      await this.createAccountFromTemplate(account, organizationId, null, manager);
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
