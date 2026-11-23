import type { DepreciationConvention } from '@virtex/shared/types';
import type { MarketTaxDepreciation } from '../markets';
import { roundAmount, toCents } from '../common/money';
import { BadRequestError } from '../i18n/localized.exception';
import { DepreciationMethod } from './entities/fixed-asset.entity';
import type { FixedAssetCategory, TaxDepreciationMethod } from './entities/fixed-asset-category.entity';
import type { FixedAssetBook } from './entities/fixed-asset-book.entity';
import type { TaxBookDto } from './dto/fixed-asset.dto';
import { assertTaxCategoryKnown } from './fixed-asset-categories.service';

/** The terms an asset's tax book is kept on. */
export interface TaxBookTerms {
  /** The authority's category: `DO-2`. */
  taxCategoryCode: string | null;
  method: TaxDepreciationMethod;
  /** The yearly rate, as a fraction. */
  annualRate: number;
  convention: DepreciationConvention;
  /** The basis it depreciates. */
  cost: number;
  /** What was deducted before the asset entered this product, and the last month it covers. */
  openingAccumulated: number;
  openingThrough: string | null;
}

/** What of the asset the terms are resolved against. */
export interface TaxBookAsset {
  cost: number;
  inServiceDate: string;
  depreciationConvention: DepreciationConvention;
}

/** The fields of a book that are fixed once it has charged a month: they decided what it charged. */
export const FIXED_TAX_TERMS = ['cost', 'openingAccumulated', 'openingThrough', 'convention'] as const;

/**
 * The terms a new tax book opens on. Not asked for, the category's — or no book, where the category
 * carries no tax rate. Asked for, what is sent, then the category's, then the market's for the tax
 * category named. Null when there is no book to open.
 */
export function openingTerms(
  request: TaxBookDto | null | undefined,
  asset: TaxBookAsset,
  category: FixedAssetCategory | null,
  market: MarketTaxDepreciation | null,
): TaxBookTerms | null {
  if (request === null) return null;
  if (request === undefined) {
    if (!category?.taxMethod || category.taxAnnualRate === null) return null;
    return checked(
      {
        taxCategoryCode: category.taxCategoryCode,
        method: category.taxMethod,
        annualRate: category.taxAnnualRate,
        convention: asset.depreciationConvention,
        cost: roundAmount(asset.cost),
        openingAccumulated: 0,
        openingThrough: null,
      },
      asset,
      market,
    );
  }
  const taxCategoryCode = request.taxCategoryCode !== undefined ? normaliseCode(request.taxCategoryCode) : (category?.taxCategoryCode ?? null);
  // The category's rate is for its own tax category; a different one brings the authority's.
  const fromCategory = category && taxCategoryCode === category.taxCategoryCode ? category : null;
  const fromMarket = taxCategoryCode ? market?.categories.find((entry) => entry.code === taxCategoryCode) : undefined;
  return checked(
    {
      taxCategoryCode,
      method: (request.method ?? fromCategory?.taxMethod ?? fromMarket?.method ?? null) as TaxDepreciationMethod,
      annualRate: (request.annualRate ?? fromCategory?.taxAnnualRate ?? fromMarket?.annualRate ?? null) as number,
      convention: request.convention ?? asset.depreciationConvention,
      cost: roundAmount(request.cost ?? asset.cost),
      openingAccumulated: roundAmount(request.openingAccumulated ?? 0),
      openingThrough: request.openingThrough ?? null,
    },
    asset,
    market,
  );
}

/**
 * The terms of a book once `request` is applied to it: what is sent changes, what is not stays. A
 * new tax category brings the authority's method and rate unless they are sent with it.
 */
export function revisedTerms(
  book: FixedAssetBook,
  request: TaxBookDto,
  asset: TaxBookAsset,
  market: MarketTaxDepreciation | null,
): TaxBookTerms {
  const current = termsOf(book);
  const taxCategoryCode = request.taxCategoryCode !== undefined ? normaliseCode(request.taxCategoryCode) : current.taxCategoryCode;
  const fromMarket =
    taxCategoryCode !== current.taxCategoryCode && taxCategoryCode
      ? market?.categories.find((entry) => entry.code === taxCategoryCode)
      : undefined;
  return checked(
    {
      taxCategoryCode,
      method: request.method ?? (fromMarket?.method as TaxDepreciationMethod | undefined) ?? current.method,
      annualRate: request.annualRate ?? fromMarket?.annualRate ?? current.annualRate,
      convention: request.convention ?? current.convention,
      cost: request.cost !== undefined ? roundAmount(request.cost) : current.cost,
      openingAccumulated: request.openingAccumulated !== undefined ? roundAmount(request.openingAccumulated) : current.openingAccumulated,
      openingThrough: request.openingThrough !== undefined ? request.openingThrough : current.openingThrough,
    },
    asset,
    market,
  );
}

/** A book's terms, as they are kept. */
export function termsOf(book: FixedAssetBook): TaxBookTerms {
  return {
    taxCategoryCode: book.taxCategoryCode,
    method: book.depreciationMethod,
    annualRate: book.annualRate,
    convention: book.depreciationConvention,
    cost: book.cost,
    openingAccumulated: book.openingAccumulatedDepreciation,
    openingThrough:
      book.openingAccumulatedDepreciation > 0 && book.openingThrough ? book.openingThrough.slice(0, 7) : null,
  };
}

/** The fixed terms `next` changes from `current`. */
export function changedFixedTerms(current: TaxBookTerms, next: TaxBookTerms): Array<(typeof FIXED_TAX_TERMS)[number]> {
  return FIXED_TAX_TERMS.filter((field) => {
    const a = current[field];
    const b = next[field];
    return typeof a === 'number' && typeof b === 'number' ? toCents(a) !== toCents(b) : a !== b;
  });
}

/** The terms hold together; the database checks each, this says which one is wrong and why. */
function checked(terms: TaxBookTerms, asset: TaxBookAsset, market: MarketTaxDepreciation | null): TaxBookTerms {
  if (!terms.method || terms.annualRate === null || terms.annualRate === undefined) {
    throw new BadRequestError('fixed_assets.tax_book_rate_required');
  }
  if (terms.method !== DepreciationMethod.STRAIGHT_LINE && terms.method !== DepreciationMethod.DECLINING_BALANCE) {
    throw new BadRequestError('fixed_assets.tax_book_method_unsupported');
  }
  assertTaxCategoryKnown(terms.taxCategoryCode, market);
  if (toCents(terms.openingAccumulated) > toCents(terms.cost)) {
    throw new BadRequestError('fixed_assets.tax_opening_above_basis', { maximum: terms.cost });
  }
  if (terms.openingAccumulated > 0) {
    if (!terms.openingThrough) throw new BadRequestError('fixed_assets.tax_opening_through_required');
    if (terms.openingThrough < asset.inServiceDate.slice(0, 7)) {
      throw new BadRequestError('fixed_assets.tax_opening_through_before_service');
    }
  } else {
    // Nothing deducted before: there is no month for it to cover.
    terms.openingThrough = null;
  }
  return terms;
}

function normaliseCode(code: string | null | undefined): string | null {
  const trimmed = code?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}
