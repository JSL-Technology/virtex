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
