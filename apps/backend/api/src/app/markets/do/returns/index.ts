import type { MarketReturnFiling } from '../../contracts';
import { purchases606 } from './purchases-606';
import { sales607 } from './sales-607';
import { annulled608 } from './annulled-608';
import { foreign609 } from './foreign-609';

/**
 * The DGII's «formatos de envío»: 606 (purchases), 607 (sales), 608 (annulled comprobantes) and
 * 609 (payments abroad), each built from the period's own facts.
 *
 * Every figure comes from a stored, document-level field. Nothing is inferred from a total, because
 * a return derived by arithmetic from an inclusive amount is a guess presented as a declaration.
 */
export const DO_FILINGS: readonly MarketReturnFiling[] = [purchases606, sales607, annulled608, foreign609];

export { purchases606, sales607, annulled608, foreign609 };
export { FORMAT_607_BOXES } from './sales-607';
export { annulmentCode } from './annulled-608';
