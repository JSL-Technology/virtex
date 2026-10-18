import { Injectable } from '@nestjs/common';

/**
 * How likely each open invoice is to be paid soon, as collections may read it without depending
 * on the AI module.
 *
 * The cash-flow projection already computes it, per invoice, from how this customer (and this
 * company's customers) actually pay: the chance of being collected within 7 and 30 days, the
 * median expected date, and whether the invoice is already later than anything the customer has
 * ever paid. The AI module registers the source (the dependency points from AI to here); when it
 * is absent — no AI engine, or no projection yet — collections ranks by age and amount alone.
 */
export interface PaymentLikelihood {
  invoiceId: string;
  pBy7: number;
  pBy30: number;
  expectedDate: string | null;
  doubtful: boolean;
}

export interface PaymentLikelihoodSnapshot {
  /** When the projection these figures come from was computed. */
  computedAt: Date | null;
  byInvoice: Map<string, PaymentLikelihood>;
}

export interface PaymentLikelihoodSource {
  forInvoices(organizationId: string, invoiceIds: string[]): Promise<PaymentLikelihoodSnapshot>;
}

@Injectable()
export class PaymentLikelihoodRegistry {
  private source: PaymentLikelihoodSource | null = null;

  provide(source: PaymentLikelihoodSource): void {
    this.source = source;
  }

  available(): boolean {
    return this.source !== null;
  }

  /** Never throws for want of a source: an empty snapshot means "rank without it". */
  async forInvoices(organizationId: string, invoiceIds: string[]): Promise<PaymentLikelihoodSnapshot> {
    if (!this.source || !invoiceIds.length) return { computedAt: null, byInvoice: new Map() };
    return this.source.forInvoices(organizationId, invoiceIds);
  }
}
