import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AgentRunEntry, AgentRunLogPort } from '../../contracts/ai/agent-runs.contract';
import { AiAgentRun } from '../entities/ai-agent-run.entity';

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
    return saved.id;
  }

  list(organizationId: string, agent?: string, limit = 30): Promise<AiAgentRun[]> {
    return this.runs.find({
      where: { organizationId, ...(agent ? { agent } : {}) },
      order: { startedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
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
