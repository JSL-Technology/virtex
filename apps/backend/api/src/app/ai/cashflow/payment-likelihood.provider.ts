import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  PaymentLikelihoodRegistry,
  PaymentLikelihoodSnapshot,
} from '../../contracts/ai/payment-likelihood.contract';
import { EngineRunsService } from '../engine/engine-runs.service';
import { AiCashflowItem } from '../entities/ai-cashflow-item.entity';

/** The cash-flow projection's per-invoice timing, offered to collections through the contract. */
@Injectable()
export class PaymentLikelihoodProvider implements OnModuleInit {
  constructor(
    private readonly registry: PaymentLikelihoodRegistry,
    private readonly runs: EngineRunsService,
    @InjectRepository(AiCashflowItem) private readonly items: Repository<AiCashflowItem>,
  ) {}

  onModuleInit(): void {
    this.registry.provide(this);
  }

  async forInvoices(organizationId: string, invoiceIds: string[]): Promise<PaymentLikelihoodSnapshot> {
    const run = await this.runs.latestSucceeded(organizationId, 'CASHFLOW');
    if (!run) return { computedAt: null, byInvoice: new Map() };
    const byInvoice = new Map<string, { invoiceId: string; pBy7: number; pBy30: number; expectedDate: string | null; doubtful: boolean }>();
    // In chunks: a large receivables book must not become one statement with thousands of params.
    for (let start = 0; start < invoiceIds.length; start += 500) {
      const rows = await this.items.find({
        where: { organizationId, runId: run.id, kind: 'RECEIVABLE', documentId: In(invoiceIds.slice(start, start + 500)) },
        select: ['documentId', 'pBy7', 'pBy30', 'expectedDate', 'doubtful'],
      });
      for (const row of rows) {
        byInvoice.set(row.documentId, {
          invoiceId: row.documentId,
          pBy7: row.pBy7,
          pBy30: row.pBy30,
          expectedDate: row.expectedDate,
          doubtful: row.doubtful,
        });
      }
    }
    return { computedAt: run.finishedAt ?? run.createdAt, byInvoice };
  }
}
