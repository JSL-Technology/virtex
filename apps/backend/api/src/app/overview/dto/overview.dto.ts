import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ActivityQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  @Max(50, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":50}' })
  @IsOptional()
  limit?: number;
}

export class EventsQueryDto {
  /** How far ahead to look. A month is the horizon a close and a filing both sit inside. */
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  @Max(180, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":180}' })
  @IsOptional()
  days?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  @Max(50, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":50}' })
  @IsOptional()
  limit?: number;
}

/**
 * Something that actually happened in this tenant.
 *
 * Deliberately structured rather than a sentence. The page that showed this used to build strings
 * like `Factura #00128 emitida a Proyectos Globales S.A.` — in Spanish, in the client, from data
 * that did not exist. A reader in English got Spanish; a reader of any language got fiction. The
 * server says what happened; the client says it in the reader's language.
 */
export interface ActivityItemDto {
  id: string;
  /** The table the event is about: `invoices`, `customer_payments`, `products`… */
  entity: string;
  entityId: string;
  /** CREATE | UPDATE | DELETE | EXPORT. Reads and sign-ins are not activity. */
  action: string;
  /** The document's own number, where it has one: `FAC-00000003`, `REC-2026-000004`. */
  reference: string | null;
  /** Who it was with — a customer, a supplier — where the document names one. */
  counterparty: string | null;
  amount: number | null;
  currencyCode: string | null;
  /** Who did it. Null for the system's own postings. */
  actorName: string | null;
  /** ISO 8601. */
  timestamp: string;
}

export type OverviewEventKind =
  | 'RECEIVABLE_DUE'
  | 'RECEIVABLE_OVERDUE'
  | 'PAYABLE_DUE'
  | 'PAYABLE_OVERDUE'
  | 'PERIOD_CLOSE';

/** A dated obligation this tenant's own data says is coming. */
export interface OverviewEventDto {
  id: string;
  kind: OverviewEventKind;
  /** ISO date (no time): the day it falls due. */
  date: string;
  reference: string | null;
  counterparty: string | null;
  amount: number | null;
  currencyCode: string | null;
  /** Where the reader goes to act on it. */
  route: string;
}

/** One item of product news, from a configured feed. */
export interface NewsItemDto {
  id: string;
  title: string;
  summary: string;
  tag: string | null;
  /** ISO 8601. */
  date: string;
  url: string | null;
}
