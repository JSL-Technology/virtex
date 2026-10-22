import { Injectable } from '@nestjs/common';

/**
 * Mail a company receives at one of its Virtex addresses, handed to the module that owns its
 * purpose: supplier bills to Purchases, customer orders to Sales.
 *
 * The inbound-mail module receives, authenticates, stores and queues each message; it knows no
 * domain. A domain registers a handler for its purpose and turns the message into drafts — never
 * into anything posted, sent or paid: what arrives by mail is written by someone outside the
 * company, so a person reviews it before it counts.
 */
export type InboundMailPurpose = 'BILLS' | 'ORDERS';

export const INBOUND_MAIL_PURPOSES: readonly InboundMailPurpose[] = ['BILLS', 'ORDERS'];

export interface InboundMailAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  /** Reads the bytes from storage. */
  read(): Promise<Buffer>;
}

export interface InboundMailMessage {
  id: string;
  organizationId: string;
  purpose: InboundMailPurpose;
  from: string;
  fromName: string | null;
  subject: string;
  /** The plain-text body (HTML reduced to text), at most 20,000 characters. */
  text: string;
  receivedAt: Date;
  attachments: InboundMailAttachment[];
}

/** What a handler made of a message. */
export interface InboundMailOutcome {
  /** PROCESSED: drafts created; NEEDS_REVIEW: read, but a person must finish it; REJECTED: nothing to do. */
  status: 'PROCESSED' | 'NEEDS_REVIEW' | 'REJECTED';
  /** Why, as an i18n key, when not processed. */
  reason?: string;
  /** The records made, to link from the inbox and to record their provenance. */
  records: Array<{ type: string; id: string; label: string; link: string }>;
  /** What a person needs to finish it (e.g. a bill suggestion to open in the form). */
  review?: Record<string, unknown>;
}

export interface InboundMailHandler {
  purpose: InboundMailPurpose;
  handle(message: InboundMailMessage): Promise<InboundMailOutcome>;
}

@Injectable()
export class InboundMailHandlerRegistry {
  private readonly handlers = new Map<InboundMailPurpose, InboundMailHandler>();

  register(handler: InboundMailHandler): void {
    if (this.handlers.has(handler.purpose)) throw new Error(`Inbound mail handler for ${handler.purpose} registered twice`);
    this.handlers.set(handler.purpose, handler);
  }

  get(purpose: InboundMailPurpose): InboundMailHandler | undefined {
    return this.handlers.get(purpose);
  }
}
