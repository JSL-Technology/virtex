import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AgentRunEntry, AgentRunLogPort } from '../../contracts/ai/agent-runs.contract';
import { AiAgentRun } from '../entities/ai-agent-run.entity';
import { recordAiProvenance } from '../../contracts/ai/provenance.contract';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The agents' log, and its reading for Admin › AI: each run with its proposals, and — for the
 * copilot, whose drafts are proposals too — what was proposed in conversation and what the person
 * did with it (confirmed, rejected, left to expire).
 */
@Injectable()
export class AgentRunsService extends AgentRunLogPort {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AiAgentRun) private readonly runs: Repository<AiAgentRun>,
  ) {
    super();
  }

  async record(entry: AgentRunEntry): Promise<string> {
    const saved = await this.runs.save(
      this.runs.create({
        organizationId: entry.organizationId,
        agent: entry.agent,
        trigger: entry.trigger,
        userId: entry.userId,
        status: entry.status,
        summary: entry.summary,
        proposals: entry.proposals.slice(0, 200),
        notes: (entry.notes ?? []).slice(0, 200),
        startedAt: entry.startedAt,
        finishedAt: new Date(),
      }),
    );
    // Each record an agent raised says so, and which run raised it.
    for (const proposal of entry.proposals.slice(0, 200)) {
      if (!UUID.test(proposal.id)) continue;
      await recordAiProvenance(this.dataSource.manager, {
        organizationId: entry.organizationId,
        entityType: proposal.kind,
        entityId: proposal.id,
        source: 'AI_AGENT',
        userId: entry.userId,
        agentRunId: saved.id,
        detail: { agent: entry.agent, trigger: entry.trigger, state: proposal.state },
      });
    }
    return saved.id;
  }

  list(organizationId: string, agent?: string, limit = 30): Promise<AiAgentRun[]> {
    return this.runs.find({
      where: { organizationId, ...(agent ? { agent } : {}) },
      order: { startedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  /**
   * What people said about the copilot's answers, newest first: the verdict, the comment, and the
   * tools the answer used — not the conversation, which is the person's own.
   */
  async copilotFeedback(organizationId: string, limit = 50) {
    const rows: Array<{ id: string; verdict: string; comment: string | null; created_at: Date; user_id: string; tools_used: string[] }> =
      await this.dataSource.query(
        `SELECT f."id", f."verdict", f."comment", f."created_at", f."user_id", m."tools_used"
           FROM "ai_message_feedback" f JOIN "ai_messages" m ON m."id" = f."message_id"
          WHERE f."organization_id" = $1
          ORDER BY f."created_at" DESC
          LIMIT $2`,
        [organizationId, Math.min(Math.max(limit, 1), 200)],
      );
    const [totals] = (await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE "verdict" = 'UP')::int AS "up", COUNT(*) FILTER (WHERE "verdict" = 'DOWN')::int AS "down",
              COUNT(*) FILTER (WHERE "verdict" = 'REPORT')::int AS "reported"
         FROM "ai_message_feedback" WHERE "organization_id" = $1 AND "created_at" >= now() - interval '30 days'`,
      [organizationId],
    )) as Array<{ up: number; down: number; reported: number }>;
    return {
      last30Days: totals ?? { up: 0, down: 0, reported: 0 },
      items: rows.map((row) => ({
        id: row.id,
        verdict: row.verdict,
        comment: row.comment,
        createdAt: row.created_at,
        userId: row.user_id,
        toolsUsed: row.tools_used ?? [],
      })),
    };
  }

  /** The copilot's proposals: what it drafted for whom, and what became of each. */
  async copilotProposals(organizationId: string, limit = 30) {
    const rows: Array<{ id: string; tool: string; summary: string; status: string; created_at: Date; decided_at: Date | null; user_id: string; result: Record<string, unknown> | null }> =
      await this.dataSource.query(
        `SELECT a."id", a."tool", a."summary", a."status", a."created_at", a."decided_at", a."user_id", a."result"
           FROM "ai_pending_actions" a
          WHERE a."organization_id" = $1
          ORDER BY a."created_at" DESC
          LIMIT $2`,
        [organizationId, Math.min(Math.max(limit, 1), 100)],
      );
    return rows.map((row) => ({
      id: row.id,
      tool: row.tool,
      summary: row.summary,
      status: row.status,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
      userId: row.user_id,
      link: typeof row.result?.['link'] === 'string' ? (row.result['link'] as string) : null,
    }));
  }
}
