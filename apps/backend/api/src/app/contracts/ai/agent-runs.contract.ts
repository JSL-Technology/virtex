/**
 * The log every agent writes to: what it did, what it proposed, and what became of it.
 *
 * An agent runs a process on its own (the replenishment agent drafting purchase orders from the
 * forecast) but never commits the company to anything: what it produces is a draft, or a request
 * for approval, and a person decides. The log is what lets that person — and an auditor — see each
 * run, its proposals, and who approved or rejected them. The AI module keeps it (Admin › AI);
 * the agents, wherever they live, write through this port.
 */
export interface AgentProposal {
  /** e.g. `purchase_order`. */
  kind: string;
  id: string;
  label: string;
  link: string | null;
  /** e.g. `DRAFT`, `PENDING_APPROVAL`. */
  state: string;
}

export interface AgentRunEntry {
  organizationId: string;
  /** e.g. `replenishment`. */
  agent: string;
  trigger: 'SCHEDULED' | 'MANUAL' | 'WORKFLOW';
  userId: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'NOTHING_TO_DO';
  /** A short machine-readable summary (counts), shown with its own labels. */
  summary: Record<string, number | string | null>;
  proposals: AgentProposal[];
  /** Why things were skipped, what failed. */
  notes?: Array<{ key: string; params?: Record<string, unknown> }>;
  startedAt: Date;
}

export abstract class AgentRunLogPort {
  abstract record(entry: AgentRunEntry): Promise<string>;
}
