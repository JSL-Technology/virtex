import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FixedAssetCategory, type TaxDepreciationMethod } from './entities/fixed-asset-category.entity';
import { DepreciationMethod } from './entities/fixed-asset.entity';
import { CreateFixedAssetCategoryDto, UpdateFixedAssetCategoryDto } from './dto/fixed-asset-category.dto';
import { assertPostableAccount } from './fixed-asset-accounts';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { assertNotInUse } from '../common/database/dependents';
import { translationsAfterEdit } from '../organizations/contracts/books-language.contract';
import { organizationMarket } from '../organizations/contracts/market.contract';
import { marketFor, type MarketTaxDepreciation, type MarketTaxDepreciationCategory } from '../markets';

/** The market's tax categories, as the category form offers them. */
export interface TaxCategoryCatalogue {
  /** The authority that fixes them: `DGII`, `SAT`. */
  authority: string;
  /** What of the rule a per-asset book does not reproduce, as a catalogue key. */
  caveatKey: string;
  categories: ReadonlyArray<Pick<MarketTaxDepreciationCategory, 'code' | 'nameKey' | 'method' | 'annualRate' | 'legalBasis'>>;
}

/** A category's settings that must hold together; the database checks each, this says which is wrong. */
interface CategoryTerms {
  depreciationMethod: DepreciationMethod | null;
  decliningAnnualRate: number | null;
  taxCategoryCode: string | null;
  taxMethod: TaxDepreciationMethod | null;
  taxAnnualRate: number | null;
}

const ACCOUNT_FIELDS = [
  'assetAccountId',
  'accumulatedDepreciationAccountId',
  'depreciationExpenseAccountId',
  'gainOnDisposalAccountId',
  'lossOnDisposalAccountId',
] as const;

/**
 * A company's categories of fixed assets (audit 2026-11-07, FINB-16): what an asset of each starts
 * with, and the tax category and rate its tax book follows.
 *
 * A category is a template. An asset copies what it needs when it is registered, so editing a
 * category, deactivating it or giving it new accounts rewrites no asset that was registered from it.
 */
@Injectable()
export class FixedAssetCategoriesService {
  constructor(private readonly dataSource: DataSource) {}

  /** The company's categories, by code; the inactive ones only when asked. */
  findAll(organizationId: string, includeInactive = false): Promise<FixedAssetCategory[]> {
    return this.dataSource.getRepository(FixedAssetCategory).find({
      where: includeInactive ? { organizationId } : { organizationId, isActive: true },
      order: { code: 'ASC' },
    });
  }

  async findOne(id: string, organizationId: string, manager: EntityManager = this.dataSource.manager): Promise<FixedAssetCategory> {
    const category = await manager.findOne(FixedAssetCategory, { where: { id, organizationId } });
    if (!category) throw new NotFoundError('fixed_assets.category_not_found', { id });
    return category;
  }

  /**
   * The tax categories the company's market fixes, or null where the product carries none — the
   * company then states the rate of each of its own categories.
   */
  async taxCatalogue(organizationId: string): Promise<TaxCategoryCatalogue | null> {
    const { country } = await organizationMarket(this.dataSource.manager, organizationId);
    return catalogueOf(marketFor(country).accounting.taxDepreciation);
  }

  async create(dto: CreateFixedAssetCategoryDto, organizationId: string): Promise<FixedAssetCategory> {
    return this.dataSource.transaction(async (manager) => {
      const code = normaliseCode(dto.code);
      await this.assertCodeFree(manager, organizationId, code);
      const market = await this.marketTaxDepreciation(manager, organizationId);
      const terms = completeTaxTerms(
        {
          depreciationMethod: dto.depreciationMethod ?? null,
          decliningAnnualRate: dto.decliningAnnualRate ?? null,
          taxCategoryCode: blankToNull(dto.taxCategoryCode),
          taxMethod: dto.taxMethod ?? null,
          taxAnnualRate: dto.taxAnnualRate ?? null,
        },
        market,
      );
      assertCoherent(terms, market);
      for (const field of ACCOUNT_FIELDS) {
        const accountId = dto[field];
        if (accountId) await assertPostableAccount(manager, organizationId, accountId);
      }
      const category = manager.create(FixedAssetCategory, {
        organizationId,
        code,
        name: dto.name.trim(),
        nameTranslations: await translationsAfterEdit(manager, organizationId, {}, dto.nameTranslations),
        description: dto.description?.trim() || null,
        usefulLifeMonths: dto.usefulLifeMonths ?? null,
        depreciationConvention: dto.depreciationConvention ?? null,
        residualRate: dto.residualRate ?? 0,
        assetAccountId: dto.assetAccountId ?? null,
        accumulatedDepreciationAccountId: dto.accumulatedDepreciationAccountId ?? null,
        depreciationExpenseAccountId: dto.depreciationExpenseAccountId ?? null,
        gainOnDisposalAccountId: dto.gainOnDisposalAccountId ?? null,
        lossOnDisposalAccountId: dto.lossOnDisposalAccountId ?? null,
        isActive: dto.isActive ?? true,
        ...terms,
      });
      return manager.save(category);
    });
  }

  /**
   * Edit a category. What is sent changes; what is not stays. The assets registered from it keep
   * what they were registered with.
   */
  async update(id: string, dto: UpdateFixedAssetCategoryDto, organizationId: string): Promise<FixedAssetCategory> {
    return this.dataSource.transaction(async (manager) => {
      const category = await manager.findOne(FixedAssetCategory, { where: { id, organizationId }, lock: { mode: 'pessimistic_write' } });
      if (!category) throw new NotFoundError('fixed_assets.category_not_found', { id });

      if (dto.code !== undefined) {
        const code = normaliseCode(dto.code);
        if (code !== category.code) await this.assertCodeFree(manager, organizationId, code, id);
        category.code = code;
      }
      const market = await this.marketTaxDepreciation(manager, organizationId);
      // A new tax category brings its own method and rate unless they are sent with it.
      const taxCategoryChanged = dto.taxCategoryCode !== undefined && blankToNull(dto.taxCategoryCode) !== category.taxCategoryCode;
      const methodChanged = dto.depreciationMethod !== undefined && dto.depreciationMethod !== category.depreciationMethod;
      const terms = completeTaxTerms(
        {
          depreciationMethod: pick(dto.depreciationMethod, category.depreciationMethod),
          // A method other than the declining balance carries no rate: changing to one clears it.
          decliningAnnualRate:
            dto.decliningAnnualRate !== undefined
              ? dto.decliningAnnualRate
              : methodChanged && dto.depreciationMethod !== DepreciationMethod.DECLINING_BALANCE
                ? null
                : category.decliningAnnualRate,
          taxCategoryCode: dto.taxCategoryCode !== undefined ? blankToNull(dto.taxCategoryCode) : category.taxCategoryCode,
          taxMethod: dto.taxMethod !== undefined ? dto.taxMethod : taxCategoryChanged ? null : category.taxMethod,
          taxAnnualRate: dto.taxAnnualRate !== undefined ? dto.taxAnnualRate : taxCategoryChanged ? null : category.taxAnnualRate,
        },
        market,
      );
      assertCoherent(terms, market);
      for (const field of ACCOUNT_FIELDS) {
        const accountId = dto[field];
        if (accountId && accountId !== category[field]) await assertPostableAccount(manager, organizationId, accountId);
      }

      if (dto.name !== undefined) category.name = dto.name.trim();
      if (dto.description !== undefined) category.description = dto.description?.trim() || null;
      if (dto.usefulLifeMonths !== undefined) category.usefulLifeMonths = dto.usefulLifeMonths;
      if (dto.depreciationConvention !== undefined) category.depreciationConvention = dto.depreciationConvention;
      if (dto.residualRate !== undefined) category.residualRate = dto.residualRate;
      if (dto.isActive !== undefined) category.isActive = dto.isActive;
      for (const field of ACCOUNT_FIELDS) {
        if (dto[field] !== undefined) category[field] = dto[field] ?? null;
      }
      Object.assign(category, terms);
      // After everything else, so a translation sent empty is removed (see `mergeTranslations`).
      category.nameTranslations = await translationsAfterEdit(manager, organizationId, category.nameTranslations, dto.nameTranslations);
      return manager.save(category);
    });
  }

  /**
   * Delete a category no asset was registered from. One that was is deactivated instead: the assets
   * keep it, and it is no longer offered for new ones.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const category = await this.findOne(id, organizationId, manager);
      await assertNotInUse(manager, 'fixed_asset_categories', category.id, 'fixed_assets.category_in_use');
      await manager.delete(FixedAssetCategory, { id, organizationId });
    });
  }

  private async marketTaxDepreciation(manager: EntityManager, organizationId: string): Promise<MarketTaxDepreciation | null> {
    const { country } = await organizationMarket(manager, organizationId);
    return marketFor(country).accounting.taxDepreciation;
  }

  private async assertCodeFree(manager: EntityManager, organizationId: string, code: string, exceptId?: string): Promise<void> {
    const taken = await manager.findOne(FixedAssetCategory, { where: { organizationId, code }, select: ['id'] });
    if (taken && taken.id !== exceptId) throw new ConflictError('fixed_assets.category_code_taken', { code });
  }
}

/** The market's catalogue as the client reads it, or null where it declares none. */
export function catalogueOf(market: MarketTaxDepreciation | null): TaxCategoryCatalogue | null {
  if (!market) return null;
  return {
    authority: market.authority,
    caveatKey: market.caveat,
    categories: market.categories.map(({ code, nameKey, method, annualRate, legalBasis }) => ({ code, nameKey, method, annualRate, legalBasis })),
  };
}

/**
 * The tax method and rate a tax category brings: where the market fixes the category, what is not
 * stated is the authority's.
 */
export function completeTaxTerms<T extends Pick<CategoryTerms, 'taxCategoryCode' | 'taxMethod' | 'taxAnnualRate'>>(
  terms: T,
  market: MarketTaxDepreciation | null,
): T {
  const fixed = terms.taxCategoryCode ? market?.categories.find((category) => category.code === terms.taxCategoryCode) : undefined;
  if (!fixed) return terms;
  return {
    ...terms,
    taxMethod: terms.taxMethod ?? (fixed.method as TaxDepreciationMethod),
    taxAnnualRate: terms.taxAnnualRate ?? fixed.annualRate,
  };
}

/** The tax category, when the market fixes its categories, is one of them. */
export function assertTaxCategoryKnown(code: string | null, market: MarketTaxDepreciation | null): void {
  if (!code || !market) return;
  if (!market.categories.some((category) => category.code === code)) {
    throw new BadRequestError('fixed_assets.tax_category_unknown', {
      code,
      authority: market.authority,
      known: market.categories.map((category) => category.code).join(', '),
    });
  }
}

function assertCoherent(terms: CategoryTerms, market: MarketTaxDepreciation | null): void {
  const declining = terms.depreciationMethod === DepreciationMethod.DECLINING_BALANCE;
  if (declining && terms.decliningAnnualRate === null) throw new BadRequestError('fixed_assets.declining_rate_required');
  if (!declining && terms.decliningAnnualRate !== null) throw new BadRequestError('fixed_assets.declining_rate_only_for_declining');
  if ((terms.taxMethod === null) !== (terms.taxAnnualRate === null)) throw new BadRequestError('fixed_assets.tax_method_and_rate_together');
  assertTaxCategoryKnown(terms.taxCategoryCode, market);
}

/** `veh ` and `VEH` are one code. */
function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function pick<T>(sent: T | undefined, current: T): T {
  return sent !== undefined ? sent : current;
}
