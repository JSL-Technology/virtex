import { Check, Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/**
 * What one company decided about its AI. A company without a row has the defaults (see
 * `AiSettingsService.defaults`). The product works in full with everything here switched off.
 */
@Entity({ name: 'ai_organization_settings' })
@Check('CHK_ai_organization_settings_retention', `"conversation_retention_days" BETWEEN 1 AND 3650`)
@Check(
  'CHK_ai_organization_settings_budgets',
  `("monthly_budget_usd" IS NULL OR "monthly_budget_usd" >= 0) AND ("daily_budget_usd" IS NULL OR "daily_budget_usd" >= 0)`,
)
export class AiOrganizationSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid', primaryKeyConstraintName: 'PK_ai_organization_settings' })
  organizationId: string;

  @TenantOwned('FK_ai_organization_settings_organization')
  organization?: TenantRef;

  /** Whether anything is sent to a language-model provider at all. */
  @Column({ name: 'language_models', type: 'boolean', default: true })
  languageModels: boolean;

  /** Features switched off one by one (`AiFeature` names). */
  @Column({ name: 'disabled_features', type: 'jsonb', default: [] })
  disabledFeatures: string[];

  /** Whether the monthly report is written unasked. Off until the company opts in. */
  @Column({ name: 'scheduled_reports', type: 'boolean', default: false })
  scheduledReports: boolean;

  /**
   * Whether the anomaly run looks at when each person works (findings about people). Off until the
   * company opts in, having told its people as its country's labour rules require.
   */
  @Column({ name: 'activity_monitoring', type: 'boolean', default: false })
  activityMonitoring: boolean;

  /** Whether product photos go to the image-embeddings provider. Off until the company opts in. */
  @Column({ name: 'image_embeddings', type: 'boolean', default: false })
  imageEmbeddings: boolean;

  @Column({ name: 'monthly_budget_usd', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  monthlyBudgetUsd: number | null;

  @Column({ name: 'daily_budget_usd', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  dailyBudgetUsd: number | null;

  @Column({ name: 'conversation_retention_days', type: 'integer', default: 180 })
  conversationRetentionDays: number;

  @Column({ name: 'mask_identifiers', type: 'boolean', default: true })
  maskIdentifiers: boolean;

  /** Budget thresholds already announced, by month: `{ "2026-10": [50, 80] }`. */
  @Column({ name: 'budget_alerts', type: 'jsonb', default: {} })
  budgetAlerts: Record<string, number[]>;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
