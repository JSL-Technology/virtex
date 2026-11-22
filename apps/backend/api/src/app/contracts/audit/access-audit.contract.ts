import type { EntityManager } from 'typeorm';

/**
 * Recording that someone READ something sensitive — a financial statement, payroll — from outside
 * a controller. Controllers use `@AuditAccess`; a service-level reader (the copilot's tools) uses
 * this port, so the same access leaves the same row whichever way it came in. Implemented by the
 * audit module; a failure to record is logged there and never fails the read.
 */
export abstract class AccessAuditPort {
  abstract recordRead(
    access: { userId: string; organizationId: string; entity: string; via: string; identifiers?: Record<string, unknown> },
  ): void;
}

/**
 * One change recorded in the caller's transaction (`ChangeAuditPort.recordChangesWithin`): the record
 * as it was and as it is, who changed it and from where.
 */
export interface TransactionalChange {
  userId: string | null;
  /** Null for a change to the platform's shared data rather than to one company's. */
  organizationId: string | null;
  /** The table the record lives in, as the audit subscriber names every other financial record. */
  entity: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  /** The record before the change; null for a creation. */
  before: object | null;
  /** The record after it — for a deletion, as it was when deleted, as the subscriber records one. */
  after: object;
  ipAddress?: string;
}

/**
 * Recording that someone CHANGED a setting outside the financial tables the audit subscriber
 * watches — what a company decided about its AI, say — with the value before and after. Implemented
 * by the audit module; a failure to record is logged there and never fails the change.
 */
export abstract class ChangeAuditPort {
  abstract recordChange(change: {
    userId: string | null;
    organizationId: string;
    entity: string;
    entityId: string;
    before: object | null;
    after: object;
  }): Promise<void>;

  /**
   * Who created or changed a record, by the audit trail: the people a check of that record must not
   * be left to (a segregation-of-duties rule — no one reviews a finding about their own entry).
   */
  abstract actorsOf(organizationId: string, entityId: string): Promise<string[]>;

  /**
   * Changes recorded IN the caller's transaction, one row each, so they commit with the change or
   * roll back with it — what a write that bypasses the audit subscriber needs (an upsert, a delete by
   * criteria, a bulk import): an audit row that survives a rolled-back change describes something
   * that never happened, and one lost while the change commits leaves it unanswerable (FINB-05).
   * Unlike `recordChange`, a failure here fails the change.
   */
  abstract recordChangesWithin(manager: EntityManager, changes: readonly TransactionalChange[]): Promise<void>;
}
