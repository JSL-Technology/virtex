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
}
