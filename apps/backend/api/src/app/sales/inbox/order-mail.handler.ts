import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  InboundMailHandler,
  InboundMailHandlerRegistry,
  InboundMailMessage,
  InboundMailOutcome,
} from '../../contracts/inbound-mail/inbound-mail.contract';
import { AiAssistContent, AiAssistPort } from '../../contracts/ai/ai-assist.contract';
import { withTenant } from '../../shared/tenancy/tenant-job';
import { isLocalizedError } from '../../i18n/localized.exception';
import { QuotesService } from '../services/quotes.service';
import { CreateQuoteDto } from '../dto/create-quote.dto';
import { CatalogueProduct, MatchedItem, ORDER_INTAKE_SYSTEM, ORDER_SCHEMA, ReadOrder, matchItem, parseReadOrder } from './order-reading';

const QUOTE_VALID_DAYS = 15;
const MAX_ORDER_ATTACHMENTS = 5;

export type OrderReviewReason = 'unknown_customer' | 'unmatched_items' | 'no_items' | 'rejected_by_rules';

export interface OrderReview {
  reasons: OrderReviewReason[];
  refusal?: string;
  customer: { id: string; name: string } | null;
  items: Array<{ description: string; quantity: number; unit: string | null; productId: string | null; productName: string | null; unitPrice: number | null; matchedBy: MatchedItem['matchedBy'] }>;
  requestedDate: string | null;
  customerReference: string | null;
  notes: string | null;
}

/**
 * Customer orders by e-mail: the customer is recognised by their address (theirs, or a contact's),
 * the model says what they asked for, every item is matched to the catalogue by code or name, and
 * the order becomes a **draft quote** at catalogue prices, assigned to the customer's account owner
 * (else whoever set up the address). A person approves it — accepting the quote is the order —
 * and invoices it as usual. An order with an unknown sender or an item that could not be matched
 * waits in the inbox, read, for a person to finish.
 */
@Injectable()
export class OrderMailHandler implements InboundMailHandler, OnModuleInit {
  readonly purpose = 'ORDERS' as const;
  private readonly logger = new Logger(OrderMailHandler.name);

  constructor(
    private readonly registry: InboundMailHandlerRegistry,
    private readonly ai: AiAssistPort,
    private readonly quotes: QuotesService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: InboundMailMessage): Promise<InboundMailOutcome> {
    const organizationId = message.organizationId;
    if (!this.ai.available()) throw new Error('AI not available'); // retried later by the queue
    const customers = await withTenant(this.dataSource, organizationId, () =>
      this.dataSource.query(
        `SELECT c."id", c."companyName" AS "name", c."account_owner_id" AS "ownerId"
           FROM "customers" c
          WHERE c."organization_id" = $1 AND c."status"::text <> 'INACTIVE'
            AND (lower(c."email") = $2 OR c."id" IN (SELECT cc."customer_id" FROM "customer_contacts" cc WHERE lower(cc."email") = $2))
          LIMIT 2`,
        [organizationId, message.from.toLowerCase()],
      ),
    ) as Array<{ id: string; name: string; ownerId: string | null }>;
    const customer = customers.length === 1 ? customers[0] : null;

    const content: AiAssistContent[] = [
      { type: 'text', text: `From: ${message.fromName ?? ''} <${message.from}>\nSubject: ${message.subject}\n\n${message.text}` },
    ];
    for (const attachment of message.attachments.slice(0, MAX_ORDER_ATTACHMENTS)) {
      const bytes = await attachment.read();
      if (attachment.mimeType === 'application/pdf') content.push({ type: 'pdf', data: bytes.toString('base64') });
      else if (/^image\/(jpeg|png|webp)$/.test(attachment.mimeType)) content.push({ type: 'image', mediaType: attachment.mimeType as 'image/jpeg', data: bytes.toString('base64') });
      else if (/xml$/.test(attachment.mimeType)) content.push({ type: 'text', text: `Attachment ${attachment.fileName}:\n${bytes.toString('utf8').slice(0, 50_000)}` });
    }
    const { value: read } = await this.ai.extract<ReadOrder>({
      feature: 'order_intake',
      promptId: 'order_intake.system',
      organizationId,
      userId: null,
      system: ORDER_INTAKE_SYSTEM,
      content,
      schema: ORDER_SCHEMA as unknown as Record<string, unknown>,
      validate: parseReadOrder,
      inputFingerprint: message.id,
    });
    if (!read.isOrder) return { status: 'REJECTED', reason: 'inbound_mail.not_an_order', records: [] };

    const catalogue = await withTenant(this.dataSource, organizationId, () =>
      this.dataSource.query(
        `SELECT "id", "name", "sku", "barcode", "price"::float AS "price" FROM "products"
          WHERE "organization_id" = $1 AND "status"::text = 'Active'
          LIMIT 20000`,
        [organizationId],
      ),
    ) as CatalogueProduct[];
    const items = read.items.map((item) => matchItem(item, catalogue));
    const reasons: OrderReviewReason[] = [];
    if (!customer) reasons.push('unknown_customer');
    if (!items.length) reasons.push('no_items');
    if (items.some((item) => !item.product)) reasons.push('unmatched_items');
    const owner = customer?.ownerId ?? message.mailboxOwnerUserId;
    const review = (extra: Partial<OrderReview> = {}): InboundMailOutcome => ({
      status: 'NEEDS_REVIEW',
      records: [],
      review: { order: { ...toReview(read, items, customer), reasons, ...extra } } as unknown as Record<string, unknown>,
    });
    if (reasons.length || !owner) return review();

    try {
      const quote = await withTenant(this.dataSource, organizationId, () =>
        this.quotes.create(quoteFrom(customer!.id, read, items, message), organizationId, { id: owner }),
      );
      return { status: 'PROCESSED', records: [{ type: 'quote', id: quote.id, label: quote.quoteNumber ?? '', link: `/quotes/${quote.id}/edit` }] };
    } catch (error) {
      this.logger.log(`Mailed order left for review: ${(error as Error)?.message}`);
      return review({ reasons: ['rejected_by_rules'], refusal: isLocalizedError(error) ? error.messageKey : 'sales.mail_quote_refused' });
    }
  }
}

function toReview(read: ReadOrder, items: MatchedItem[], customer: { id: string; name: string } | null): Omit<OrderReview, 'reasons'> {
  return {
    customer: customer && { id: customer.id, name: customer.name },
    items: items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      productId: item.product?.id ?? null,
      productName: item.product?.name ?? null,
      unitPrice: item.product?.price ?? null,
      matchedBy: item.matchedBy,
    })),
    requestedDate: read.requestedDate,
    customerReference: read.customerReference,
    notes: read.notes,
  };
}

/** The draft quote: catalogue prices, today's date, the customer's reference and wishes in the notes. */
export function quoteFrom(customerId: string, read: ReadOrder, items: MatchedItem[], message: Pick<InboundMailMessage, 'from' | 'subject'>, today = new Date()): CreateQuoteDto {
  const issueDate = today.toISOString().slice(0, 10);
  const notes = [
    `${message.from}: ${message.subject}`.slice(0, 300),
    read.customerReference ? `Ref. ${read.customerReference}` : null,
    read.requestedDate ? `→ ${read.requestedDate}` : null,
    read.notes,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    customerId,
    issueDate,
    expiryDate: new Date(today.getTime() + QUOTE_VALID_DAYS * 86_400_000).toISOString().slice(0, 10),
    notes: notes.slice(0, 1000),
    lines: items.map((item) => ({
      productId: item.product!.id,
      description: item.product!.name,
      quantity: item.quantity,
      unitPrice: item.product!.price,
    })),
  } as CreateQuoteDto;
}
