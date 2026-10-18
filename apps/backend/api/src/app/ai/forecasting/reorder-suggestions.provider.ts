import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { ReorderSuggestionRegistry, ReorderSuggestion } from '../../contracts/ai/reorder-suggestions.contract';
import { EngineRunsService } from '../engine/engine-runs.service';
import { AiInventoryInsight } from '../entities/ai-inventory-insight.entity';

/** The latest forecast's reorder quantities, offered to purchasing through the contract. */
@Injectable()
export class ReorderSuggestionsProvider implements OnModuleInit {
  constructor(
    private readonly registry: ReorderSuggestionRegistry,
    private readonly runs: EngineRunsService,
    @InjectRepository(AiInventoryInsight) private readonly insights: Repository<AiInventoryInsight>,
  ) {}

  onModuleInit(): void {
    this.registry.provide(this);
  }

  async suggestions(organizationId: string): Promise<{ computedAt: Date | null; items: ReorderSuggestion[] }> {
    const run = await this.runs.latestSucceeded(organizationId, 'FORECAST');
    if (!run) return { computedAt: null, items: [] };
    const rows = await this.insights.find({
      where: { organizationId, runId: run.id, status: In(['STOCKOUT_RISK', 'REORDER']), suggestedOrderQty: MoreThan(0) },
      order: { stockoutDate: 'ASC' },
      take: 5_000,
    });
    return {
      computedAt: run.finishedAt ?? run.createdAt,
      items: rows.map((row) => ({
        productId: row.productId,
        warehouseId: row.warehouseId,
        branchId: row.branchId,
        suggestedQty: row.suggestedOrderQty,
        onHand: row.onHand,
        stockoutDate: row.stockoutDate,
        leadTimeDays: row.leadTimeDays,
        status: row.status as 'STOCKOUT_RISK' | 'REORDER',
      })),
    };
  }
}
