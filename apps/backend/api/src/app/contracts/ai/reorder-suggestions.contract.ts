import { Injectable } from '@nestjs/common';

/**
 * What the demand forecast says to reorder, as purchasing may read it without depending on the AI
 * module: per product and warehouse, the quantity that covers the lead time at the service level,
 * and how soon it runs out. The AI module registers the source from its latest forecast run.
 */
export interface ReorderSuggestion {
  productId: string;
  warehouseId: string;
  branchId: string | null;
  suggestedQty: number;
  onHand: number;
  stockoutDate: string | null;
  leadTimeDays: number | null;
  status: 'STOCKOUT_RISK' | 'REORDER';
}

export interface ReorderSuggestionSource {
  suggestions(organizationId: string): Promise<{ computedAt: Date | null; items: ReorderSuggestion[] }>;
}

@Injectable()
export class ReorderSuggestionRegistry {
  private source: ReorderSuggestionSource | null = null;

  provide(source: ReorderSuggestionSource): void {
    this.source = source;
  }

  available(): boolean {
    return this.source !== null;
  }

  async suggestions(organizationId: string): Promise<{ computedAt: Date | null; items: ReorderSuggestion[] }> {
    if (!this.source) return { computedAt: null, items: [] };
    return this.source.suggestions(organizationId);
  }
}
