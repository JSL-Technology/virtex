import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { AiConversation } from './ai-conversation.entity';

export type AiChartType = 'line' | 'area' | 'column' | 'bar' | 'pie';

/** Which part of a read tool's result a chart draws: the rows, the label of each, the series. */
export interface AiChartMapping {
  /** Dotted path to the rows in the tool's result; empty for the result itself. */
  rows: string;
  /** Field of each row that names its category (the x axis, or the slice). */
  label: string;
  series: Array<{ name: string; field: string }>;
  /** Currency code or unit the values are in, when the result states one. */
  unit: string | null;
}

/** What the chart showed: drawn by the server from the tool's own result, never typed by the model. */
export interface AiChartData {
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
  unit: string | null;
  /** How many rows the result had beyond the ones drawn. */
  omitted: number;
  drawnAt: string;
}

/**
 * A chart the copilot drew, and the recipe it was drawn from. See the `AiCharts` migration.
 */
@Entity({ name: 'ai_charts' })
@Check('CHK_ai_charts_type', `"chart_type" IN ('line', 'area', 'column', 'bar', 'pie')`)
@Index('IDX_ai_charts_org_conversation', ['organizationId', 'conversationId'])
@Index('IDX_ai_charts_org_user_pinned', ['organizationId', 'userId', 'pinnedAt'], { where: '"pinned_at" IS NOT NULL' })
export class AiChart {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_charts_organization')
  organization?: TenantRef;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  @ManyToOne('AiConversation', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'conversation_id', foreignKeyConstraintName: 'FK_ai_charts_conversation' })
  conversation?: AiConversation | null;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ name: 'chart_type', type: 'varchar', length: 16 })
  chartType: AiChartType;

  @Column({ name: 'source_tool', type: 'varchar', length: 64 })
  sourceTool: string;

  @Column({ name: 'source_input', type: 'jsonb', default: {} })
  sourceInput: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  mapping: AiChartMapping;

  @Column({ type: 'jsonb' })
  snapshot: AiChartData;

  @Column({ name: 'pinned_at', type: 'timestamptz', nullable: true })
  pinnedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
