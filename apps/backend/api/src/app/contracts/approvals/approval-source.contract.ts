/**
 * A place where documents wait for someone's decision (QA A-11).
 *
 * The approvals centre and «Mi trabajo» read only the generic workflow engine's requests, so a
 * purchase order or a requisition «por aprobar» — which have their own approval lifecycle — never
 * appeared: both said «no tienes nada pendiente» while documents waited. Each domain now registers
 * its source of pending decisions here, and the inbox reads them all. Neither side imports the
 * other, as with closing blockers and data transfer.
 */

/** Who is looking, and what they hold — from the authenticated principal, never from the request. */
export interface ApprovalViewer {
  readonly userId: string;
  readonly organizationId: string;
  readonly permissions: readonly string[];
  readonly roleIds: readonly string[];
}

/** One document waiting for a decision. */
export interface PendingDecision {
  /** The source that owns it; decisions are routed back to it. */
  readonly source: string;
  readonly id: string;
  /** Catalogue key of the kind of document. */
  readonly documentTypeKey: string;
  readonly number: string | null;
  /** The counterparty or requester, when the document has one. */
  readonly party: string | null;
  readonly amount: number | null;
  readonly currencyCode: string | null;
  readonly requestedAt: string | null;
  /** Where the document lives in the client, so the reviewer can read it before deciding. */
  readonly route: string | null;
  /** For multi-step workflows: the step now waiting. */
  readonly step: number | null;
  /**
   * Whether THIS viewer may decide it. Shown even when false, with the reason: a document the
   * viewer raised is waiting on someone else, and hiding it would hide that it is stuck.
   */
  readonly canDecide: boolean;
  readonly blockedReasonKey: string | null;
}

export interface ApprovalSource {
  readonly sourceId: string;
  /** The permission deciding on this source requires; viewers without it never see its items. */
  readonly decidePermission: string;
  pendingFor(viewer: ApprovalViewer): Promise<PendingDecision[]>;
  approve(id: string, viewer: ApprovalViewer, comment?: string): Promise<void>;
  /** A rejection always carries its reason: a refusal without one is not a decision. */
  reject(id: string, viewer: ApprovalViewer, reason: string): Promise<void>;
}
