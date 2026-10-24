import { EntityManager } from 'typeorm';

/**
 * Where a record came from, when the AI had a hand in it (H-M7).
 *
 * An auditor looking at an invoice, a purchase order or a supplier bill can tell whether a person
 * typed it, the assistant drafted it, an agent raised it or it was read from a document — and, for
 * a read document, which fields were kept as the AI read them and which a person corrected. That
 * last list is also the honest measure of how well the reading works.
 *
 * Any module that creates a record with the AI's help writes here; the AI module owns the table
 * (`ai_record_provenance`) and serves it. A plain function over the caller's `EntityManager`, so the
 * row commits with the record it describes or rolls back with it.
 */
export type AiProvenanceSource = 'AI_COPILOT' | 'AI_CAPTURE' | 'AI_AGENT' | 'AI_RECONCILIATION' | 'AI_MAIL' | 'AI_MCP';

export const AI_PROVENANCE_SOURCES: readonly AiProvenanceSource[] = ['AI_COPILOT', 'AI_CAPTURE', 'AI_AGENT', 'AI_RECONCILIATION', 'AI_MAIL', 'AI_MCP'];

export interface AiProvenanceFields {
  /** Saved exactly as the AI read or proposed them. */
  accepted: string[];
  /** Changed by a person before saving. */
  edited: string[];
}

export interface AiProvenanceEntry {
  organizationId: string;
  /** e.g. `invoice`, `vendor_bill`, `purchase_order`. */
  entityType: string;
  entityId: string;
  source: AiProvenanceSource;
  userId?: string | null;
  aiRequestId?: string | null;
  pendingActionId?: string | null;
  agentRunId?: string | null;
  fields?: AiProvenanceFields | null;
  detail?: Record<string, unknown>;
}

export interface AiProvenanceRow {
  source: AiProvenanceSource;
  userId: string | null;
  aiRequestId: string | null;
  pendingActionId: string | null;
  agentRunId: string | null;
  fields: AiProvenanceFields | null;
  detail: Record<string, unknown>;
  createdAt: Date;
}

/** Record (or refresh) where a record came from. One row per record and source. */
export async function recordAiProvenance(manager: EntityManager, entry: AiProvenanceEntry): Promise<void> {
  await manager.query(
    `INSERT INTO "ai_record_provenance"
       ("organization_id", "entity_type", "entity_id", "source", "user_id", "ai_request_id", "pending_action_id",
        "agent_run_id", "fields", "detail")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT ON CONSTRAINT "UQ_ai_record_provenance_record_source" DO UPDATE SET
       "user_id" = EXCLUDED."user_id", "ai_request_id" = EXCLUDED."ai_request_id",
       "pending_action_id" = EXCLUDED."pending_action_id", "agent_run_id" = EXCLUDED."agent_run_id",
       "fields" = EXCLUDED."fields", "detail" = EXCLUDED."detail"`,
    [
      entry.organizationId,
      entry.entityType,
      entry.entityId,
      entry.source,
      entry.userId ?? null,
      entry.aiRequestId ?? null,
      entry.pendingActionId ?? null,
      entry.agentRunId ?? null,
      entry.fields ? JSON.stringify(entry.fields) : null,
      JSON.stringify(entry.detail ?? {}),
    ],
  );
}

/** Where one record came from; empty when no AI was involved. */
export async function aiProvenanceOf(
  manager: EntityManager,
  organizationId: string,
  entityType: string,
  entityId: string,
): Promise<AiProvenanceRow[]> {
  return manager.query(
    `SELECT "source", "user_id" AS "userId", "ai_request_id" AS "aiRequestId", "pending_action_id" AS "pendingActionId",
            "agent_run_id" AS "agentRunId", "fields", "detail", "created_at" AS "createdAt"
       FROM "ai_record_provenance"
      WHERE "organization_id" = $1 AND "entity_type" = $2 AND "entity_id" = $3
      ORDER BY "created_at"`,
    [organizationId, entityType, entityId],
  );
}

/**
 * Which of the AI's suggested values were saved unchanged. A field the AI left empty is neither:
 * it suggested nothing. Numbers match to the cent, dates by day, text ignoring case, spaces and
 * dashes (`B0100000001` is `b01-0000-0001`).
 */
export function compareFields(suggested: Record<string, unknown>, saved: Record<string, unknown>): AiProvenanceFields {
  const accepted: string[] = [];
  const edited: string[] = [];
  for (const [field, value] of Object.entries(suggested)) {
    if (value === null || value === undefined || value === '') continue;
    (sameValue(value, saved[field]) ? accepted : edited).push(field);
  }
  return { accepted: accepted.sort(), edited: edited.sort() };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (b === null || b === undefined || b === '') return false;
  const numA = typeof a === 'number' ? a : null;
  const numB = typeof b === 'number' ? b : typeof b === 'string' && /^-?\d+(\.\d+)?$/.test(b.trim()) ? Number(b) : null;
  if (numA !== null && numB !== null) return Math.abs(numA - numB) < 0.005;
  const text = (value: unknown) => {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const raw = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw.toUpperCase().replace(/[\s-]/g, '');
  };
  return text(a) === text(b);
}

/** The entity type a staged supplier document is recorded under while it waits for its bill. */
export const CAPTURED_ATTACHMENT = 'vendor_bill_attachment';

/**
 * A record saved from one or more documents the AI read: compares what was read with what was
 * saved and records the record's provenance. Does nothing when no attached document was read by
 * the AI (a file merely attached).
 */
export async function recordCapturedRecord(
  manager: EntityManager,
  input: {
    organizationId: string;
    entityType: string;
    entityId: string;
    attachmentIds: string[];
    saved: Record<string, unknown>;
    userId: string | null;
  },
): Promise<void> {
  if (!input.attachmentIds.length) return;
  const reads: Array<{ ai_request_id: string | null; detail: { suggested?: Record<string, unknown>; channel?: { kind: string; inboundMessageId?: string } }; entity_id: string }> = await manager.query(
    `SELECT "ai_request_id", "detail", "entity_id" FROM "ai_record_provenance"
      WHERE "organization_id" = $1 AND "entity_type" = $2 AND "entity_id" = ANY($3::uuid[]) AND "source" = 'AI_CAPTURE'
      ORDER BY "created_at" DESC`,
    [input.organizationId, CAPTURED_ATTACHMENT, input.attachmentIds],
  );
  const read = reads[0];
  if (!read) return;
  await recordAiProvenance(manager, {
    organizationId: input.organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    source: 'AI_CAPTURE',
    userId: input.userId,
    aiRequestId: read.ai_request_id,
    fields: compareFields(read.detail?.suggested ?? {}, input.saved),
    detail: { attachmentId: read.entity_id },
  });
  // Received by mail: the record says that too, with the message it came in.
  if (read.detail?.channel?.kind === 'mail') {
    await recordAiProvenance(manager, {
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      source: 'AI_MAIL',
      userId: input.userId,
      detail: { inboundMessageId: read.detail.channel.inboundMessageId ?? null, attachmentId: read.entity_id },
    });
  }
}
