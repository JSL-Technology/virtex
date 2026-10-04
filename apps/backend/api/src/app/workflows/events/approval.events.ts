/**
 * What the approval flow tells the rest of the system (QA B-02: nobody was told anything — an
 * approver learned of a request by opening the inbox, a requester of the decision by finding the
 * document posted or not).
 *
 * Both are published AFTER the transaction that produced them has committed — by whoever owns that
 * transaction — so a listener never announces a request that rolled back, and never has to join
 * another module's transaction to find out.
 */
export const APPROVAL_REQUESTED = 'approval.requested';
export const APPROVAL_DECIDED = 'approval.decided';

export interface ApprovalRequestedEvent {
  organizationId: string;
  requestId: string;
  documentType: string;
  documentId: string;
  amount: number;
  currencyCode?: string | null;
  /** The document's own number, when it has one (`OC-2026-000012`). */
  reference?: string | null;
  /** Who decides: the members of a role (a workflow step) … */
  roleId?: string | null;
  /** … or everybody holding a permission (procurement's single approval). */
  permission?: string | null;
  /** The step now open, in a multi-step policy. */
  stepOrder?: number | null;
  requestedByUserId: string | null;
}

export interface ApprovalDecidedEvent {
  organizationId: string;
  requestId: string;
  documentType: string;
  documentId: string;
  decision: 'APPROVED' | 'REJECTED';
  requestedByUserId: string | null;
  actorUserId: string;
  reason?: string | null;
  reference?: string | null;
}
