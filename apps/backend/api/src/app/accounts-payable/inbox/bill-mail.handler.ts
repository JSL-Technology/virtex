import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  InboundMailHandler,
  InboundMailHandlerRegistry,
  InboundMailMessage,
  InboundMailOutcome,
} from '../../contracts/inbound-mail/inbound-mail.contract';
import { EntitlementsPort } from '../../saas/contracts/entitlements.contract';
import { AiAssistPort } from '../../contracts/ai/ai-assist.contract';
import { withTenant } from '../../shared/tenancy/tenant-job';
import { isLocalizedError } from '../../i18n/localized.exception';
import { BillCaptureService, BillCaptureSuggestion } from '../bill-capture.service';
import { AccountsPayableService } from '../accounts-payable.service';
import { CreateVendorBillDto } from '../dto/create-vendor-bill.dto';
import { matchPurchaseOrder, OpenOrder, OrderMatch } from './purchase-order-match';

/** Why a read bill was left for a person instead of becoming a draft. */
export type BillReviewReason =
  | 'unknown_supplier'
  | 'not_a_bill'
  | 'possible_duplicate'
  | 'document_number'
  | 'arithmetic'
  | 'unmatched_lines'
  | 'no_total'
  | 'rejected_by_rules';

export interface BillReviewItem {
  attachmentId: string;
  fileName: string;
  reasons: BillReviewReason[];
  /** The server's refusal, when saving the draft was refused. */
  refusal?: string;
  suggestion: BillCaptureSuggestion;
  purchaseOrder: { id: string; number: string } | null;
}

/**
 * Supplier bills by e-mail: each PDF, photo or XML attached is read (the same reading and checks
 * as a bill uploaded by hand, by the company's market) and becomes a **draft** bill when nothing is
 * in doubt — the supplier known by its tax identifier, the document number valid, the arithmetic
 * right, no duplicate, every line on a product or an account — linked to the open purchase order
 * it is clearly for. Anything in doubt waits in the inbox with what was read, for a person to
 * finish in the form. Nothing is ever approved or posted from here.
 */
@Injectable()
export class BillMailHandler implements InboundMailHandler, OnModuleInit {
  readonly purpose = 'BILLS' as const;
  private readonly logger = new Logger(BillMailHandler.name);

  constructor(
    private readonly registry: InboundMailHandlerRegistry,
    private readonly capture: BillCaptureService,
    private readonly bills: AccountsPayableService,
    private readonly entitlements: EntitlementsPort,
    private readonly ai: AiAssistPort,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: InboundMailMessage): Promise<InboundMailOutcome> {
    const organizationId = message.organizationId;
    const documents = message.attachments.filter((attachment) => /^(application\/pdf|image\/|application\/xml|text\/xml)/.test(attachment.mimeType));
    if (!documents.length) return { status: 'REJECTED', reason: 'inbound_mail.no_document', records: [] };
    const allowed = await withTenant(this.dataSource, organizationId, () => this.entitlements.checkFeature(organizationId, 'ai_vision'));
    if (!allowed) return { status: 'REJECTED', reason: 'inbound_mail.not_in_plan', records: [] };
    if (!this.ai.available()) throw new Error('AI not available'); // retried later by the queue

    const records: InboundMailOutcome['records'] = [];
    const review: BillReviewItem[] = [];
    for (const document of documents) {
      const suggestion = await this.capture.capture(
        organizationId,
        null,
        { fileName: document.fileName, mimeType: document.mimeType, buffer: await document.read() },
        { kind: 'mail', inboundMessageId: message.id },
      );
      const purchaseOrder = suggestion.supplier.match ? await this.purchaseOrderFor(organizationId, suggestion) : null;
      const reasons = reviewReasons(suggestion);
      if (reasons.length) {
        review.push({ attachmentId: suggestion.attachment.id, fileName: document.fileName, reasons, suggestion, purchaseOrder: purchaseOrder && { id: purchaseOrder.orderId, number: purchaseOrder.number } });
        continue;
      }
      try {
        const bill = await withTenant(this.dataSource, organizationId, () => this.bills.create(draftFrom(suggestion, purchaseOrder), organizationId, null));
        records.push({ type: 'vendor_bill', id: bill.id, label: bill.ncf ?? suggestion.supplier.match!.name, link: `/accounts-payable/${bill.id}` });
      } catch (error) {
        // The bill's own rules refused it (a closed period, a fiscal check): a person decides.
        this.logger.log(`Mailed bill left for review: ${(error as Error)?.message}`);
        review.push({
          attachmentId: suggestion.attachment.id,
          fileName: document.fileName,
          reasons: ['rejected_by_rules'],
          refusal: isLocalizedError(error) ? error.messageKey : 'accounts_payable.mail_draft_refused',
          suggestion,
          purchaseOrder: purchaseOrder && { id: purchaseOrder.orderId, number: purchaseOrder.number },
        });
      }
    }
    return {
      status: review.length ? 'NEEDS_REVIEW' : 'PROCESSED',
      records,
      ...(review.length ? { review: { bills: review } as unknown as Record<string, unknown> } : {}),
    };
  }

  private purchaseOrderFor(organizationId: string, suggestion: BillCaptureSuggestion): Promise<OrderMatch | null> {
    return withTenant(this.dataSource, organizationId, async () => {
      const rows: Array<{ id: string; number: string; total: string; line_id: string | null; product_id: string | null; quantity: string | null; billed_quantity: string | null; unit_price: string | null }> =
        await this.dataSource.query(
          `SELECT o."id", o."number", o."total", l."id" AS "line_id", l."product_id", l."quantity", l."billed_quantity", l."unit_price"
             FROM "purchase_orders" o
             LEFT JOIN "purchase_order_lines" l ON l."order_id" = o."id"
            WHERE o."organization_id" = $1 AND o."supplier_id" = $2 AND o."cancelled_at" IS NULL
              AND o."status" IN ('APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED')
            ORDER BY o."order_date" DESC
            LIMIT 500`,
          [organizationId, suggestion.supplier.match!.id],
        );
      const orders = new Map<string, OpenOrder>();
      for (const row of rows) {
        const order = orders.get(row.id) ?? { id: row.id, number: row.number, total: Number(row.total), unbilled: 0, lines: [] };
        if (row.line_id) {
          const quantity = Number(row.quantity ?? 0);
          const billed = Number(row.billed_quantity ?? 0);
          order.lines.push({ id: row.line_id, productId: row.product_id, quantity, billedQuantity: billed });
          order.unbilled += Math.max(quantity - billed, 0) * Number(row.unit_price ?? 0);
        }
        orders.set(row.id, order);
      }
      return matchPurchaseOrder([...orders.values()].filter((order) => order.lines.some((line) => line.quantity > line.billedQuantity)), {
        total: suggestion.bill.subtotal ?? suggestion.bill.total,
        lines: suggestion.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      });
    });
  }
}

/** Everything that keeps a read bill from becoming a draft on its own. */
export function reviewReasons(suggestion: BillCaptureSuggestion): BillReviewReason[] {
  const reasons: BillReviewReason[] = [];
  if (suggestion.documentKind !== 'invoice') reasons.push('not_a_bill');
  if (!suggestion.supplier.match) reasons.push('unknown_supplier');
  if (suggestion.checks.duplicateBillId || suggestion.checks.sameFileBillId) reasons.push('possible_duplicate');
  if (suggestion.checks.ncf.status === 'invalid' || suggestion.checks.ncf.status === 'missing') reasons.push('document_number');
  if (suggestion.checks.arithmetic.length) reasons.push('arithmetic');
  if (!suggestion.lines.length || suggestion.lines.some((line) => !line.productId && !line.expenseAccountId)) reasons.push('unmatched_lines');
  if (!suggestion.bill.total || !suggestion.bill.date) reasons.push('no_total');
  return reasons;
}

/** The draft bill, as the form would have saved it, from a suggestion nothing is in doubt about. */
export function draftFrom(suggestion: BillCaptureSuggestion, order: OrderMatch | null): CreateVendorBillDto {
  const bill = suggestion.bill;
  return {
    vendorId: suggestion.supplier.match!.id,
    ...(order ? { purchaseOrderId: order.orderId } : {}),
    date: bill.date!,
    dueDate: bill.dueDate ?? bill.date!,
    lines: suggestion.lines.map((line, index) => ({
      product: line.description.slice(0, 500),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      total: line.total,
      ...(line.productId ? { productId: line.productId } : {}),
      ...(line.expenseAccountId ? { expenseAccountId: line.expenseAccountId } : {}),
      ...(order?.lineMap[index] ? { purchaseOrderLineId: order.lineMap[index] } : {}),
    })),
    total: bill.total ?? undefined,
    ...(bill.currencyCode ? { currencyCode: bill.currencyCode } : {}),
    ...(bill.ncf ? { ncf: bill.ncf } : {}),
    ...(bill.ncfModified ? { ncfModified: bill.ncfModified } : {}),
    ...(bill.taxAmount !== null ? { taxAmount: bill.taxAmount } : {}),
    ...(bill.serviceCharge !== null ? { serviceCharge: bill.serviceCharge } : {}),
    ...(bill.purchaseCategory ? { purchaseCategory: bill.purchaseCategory } : {}),
    ...(bill.paymentForm ? { paymentForm: bill.paymentForm } : {}),
    attachmentIds: [suggestion.attachment.id],
  } as CreateVendorBillDto;
}
