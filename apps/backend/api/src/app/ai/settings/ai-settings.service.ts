import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AiOrganizationSettings } from '../entities/ai-organization-settings.entity';
import { AiFeature, AI_ROUTES } from '../gateway/ai-models';
import { BadRequestError, ForbiddenError, TooManyRequestsError } from '../../i18n/localized.exception';
import { AI_BUDGET_THRESHOLD, AiBudgetThresholdEvent } from '../../contracts/ai-insights/ai-budget.contract';

/** The settings a company has in effect: its own row over the platform's defaults. */
export interface EffectiveAiSettings {
  languageModels: boolean;
  disabledFeatures: AiFeature[];
  scheduledReports: boolean;
  imageEmbeddings: boolean;
  /** In effect: the company's own, or the platform default; never above the platform ceiling. */
  monthlyBudgetUsd: number;
  dailyBudgetUsd: number | null;
  conversationRetentionDays: number;
  maskIdentifiers: boolean;
  /** The ceiling a company may raise its budget to, from the deployment. */
  maxMonthlyBudgetUsd: number;
}

export interface AiSettingsUpdate {
  languageModels?: boolean;
  disabledFeatures?: string[];
  scheduledReports?: boolean;
  imageEmbeddings?: boolean;
  monthlyBudgetUsd?: number | null;
  dailyBudgetUsd?: number | null;
  conversationRetentionDays?: number;
  maskIdentifiers?: boolean;
}

export interface AiSpend {
  monthUsd: number;
  dayUsd: number;
}

const BUDGET_THRESHOLDS = [50, 80, 100] as const;
export const AI_FEATURES = Object.keys(AI_ROUTES) as AiFeature[];

/**
 * What a company decided about its AI, and the policy every model call is held to.
 *
 * The gateway asks `assertCallAllowed` before every call — the AI switched on for the company, the
 * feature not switched off, the month's and the day's budget not spent — so no feature can forget
 * to. The budget is money, not credits: credits measure the plan, a budget measures the bill, and
 * the top plan's credits are unlimited. The check reads the cost ledger (`ai_requests`); calls
 * already in flight when it is crossed may finish, so a budget is overshot by at most those.
 */
@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    @InjectRepository(AiOrganizationSettings) private readonly settings: Repository<AiOrganizationSettings>,
  ) {}

  /** Platform defaults (deployment settings) for a company that has not set its own. */
  defaults(): EffectiveAiSettings {
    const max = this.maxMonthlyBudget();
    return {
      languageModels: true,
      disabledFeatures: [],
      scheduledReports: false,
      imageEmbeddings: false,
      monthlyBudgetUsd: Math.min(this.config.get<number>('AI_DEFAULT_MONTHLY_BUDGET_USD') ?? 200, max),
      dailyBudgetUsd: null,
      conversationRetentionDays: 180,
      maskIdentifiers: true,
      maxMonthlyBudgetUsd: max,
    };
  }

  async get(organizationId: string): Promise<EffectiveAiSettings> {
    const row = await this.settings.findOne({ where: { organizationId } });
    const defaults = this.defaults();
    if (!row) return defaults;
    return {
      languageModels: row.languageModels,
      disabledFeatures: (row.disabledFeatures ?? []).filter((feature): feature is AiFeature => AI_FEATURES.includes(feature as AiFeature)),
      scheduledReports: row.scheduledReports,
      imageEmbeddings: row.imageEmbeddings,
      monthlyBudgetUsd: Math.min(row.monthlyBudgetUsd ?? defaults.monthlyBudgetUsd, defaults.maxMonthlyBudgetUsd),
      dailyBudgetUsd: row.dailyBudgetUsd,
      conversationRetentionDays: row.conversationRetentionDays,
      maskIdentifiers: row.maskIdentifiers,
      maxMonthlyBudgetUsd: defaults.maxMonthlyBudgetUsd,
    };
  }

  async update(organizationId: string, userId: string, change: AiSettingsUpdate): Promise<EffectiveAiSettings> {
    const current = await this.get(organizationId);
    if (change.disabledFeatures?.some((feature) => !AI_FEATURES.includes(feature as AiFeature))) {
      throw new BadRequestError('ai.settings.unknown_feature');
    }
    if (change.monthlyBudgetUsd !== undefined && change.monthlyBudgetUsd !== null && change.monthlyBudgetUsd > current.maxMonthlyBudgetUsd) {
      throw new BadRequestError('ai.settings.budget_above_ceiling', { max: current.maxMonthlyBudgetUsd });
    }
    const monthly = change.monthlyBudgetUsd === undefined ? current.monthlyBudgetUsd : change.monthlyBudgetUsd;
    const daily = change.dailyBudgetUsd === undefined ? current.dailyBudgetUsd : change.dailyBudgetUsd;
    if (daily !== null && monthly !== null && daily > monthly) throw new BadRequestError('ai.settings.daily_above_monthly');
    await this.settings.save(
      this.settings.create({
        organizationId,
        languageModels: change.languageModels ?? current.languageModels,
        disabledFeatures: [...new Set(change.disabledFeatures ?? current.disabledFeatures)],
        scheduledReports: change.scheduledReports ?? current.scheduledReports,
        imageEmbeddings: change.imageEmbeddings ?? current.imageEmbeddings,
        monthlyBudgetUsd: monthly,
        dailyBudgetUsd: daily,
        conversationRetentionDays: change.conversationRetentionDays ?? current.conversationRetentionDays,
        maskIdentifiers: change.maskIdentifiers ?? current.maskIdentifiers,
        updatedByUserId: userId,
      }),
    );
    return this.get(organizationId);
  }

  /** What the company has spent on AI this month and today (UTC), from the cost ledger. */
  async spend(organizationId: string): Promise<AiSpend> {
    const [row] = (await this.dataSource.query(
      `SELECT COALESCE(SUM("cost_micro_usd"), 0)::bigint AS month,
              COALESCE(SUM("cost_micro_usd") FILTER (WHERE "created_at" >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::bigint AS day
         FROM "ai_requests"
        WHERE "organization_id" = $1 AND "created_at" >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [organizationId],
    )) as Array<{ month: string; day: string }>;
    return { monthUsd: Number(row?.month ?? 0) / 1_000_000, dayUsd: Number(row?.day ?? 0) / 1_000_000 };
  }

  /**
   * Refuses a call the company has not allowed or can no longer afford. Called by the gateway
   * before every model call, in the tenant's context.
   */
  async assertCallAllowed(organizationId: string, feature: AiFeature): Promise<void> {
    const settings = await this.get(organizationId);
    if (!settings.languageModels) throw new ForbiddenError('ai.disabled_for_organization');
    if (settings.disabledFeatures.includes(feature)) throw new ForbiddenError('ai.feature_disabled_for_organization');
    const spent = await this.spend(organizationId);
    if (spent.monthUsd >= settings.monthlyBudgetUsd) {
      throw new TooManyRequestsError('ai.budget_exhausted', { budget: settings.monthlyBudgetUsd });
    }
    if (settings.dailyBudgetUsd !== null && spent.dayUsd >= settings.dailyBudgetUsd) {
      throw new TooManyRequestsError('ai.daily_budget_exhausted', { budget: settings.dailyBudgetUsd });
    }
  }

  /**
   * After a call is recorded: announce each budget threshold crossed this month, once. The claim is
   * one conditional UPDATE, so of several replicas recording at once exactly one announces.
   */
  async afterCall(organizationId: string): Promise<void> {
    try {
      const settings = await this.get(organizationId);
      if (settings.monthlyBudgetUsd <= 0) return;
      const spent = await this.spend(organizationId);
      const percent = (spent.monthUsd / settings.monthlyBudgetUsd) * 100;
      const month = new Date().toISOString().slice(0, 7);
      for (const threshold of BUDGET_THRESHOLDS) {
        if (percent < threshold) break;
        const claimed = (await this.dataSource.query(
          `INSERT INTO "ai_organization_settings" ("organization_id", "budget_alerts")
           VALUES ($1, jsonb_build_object($2::text, jsonb_build_array($3::int)))
           ON CONFLICT ("organization_id") DO UPDATE
              SET "budget_alerts" = jsonb_set(
                    "ai_organization_settings"."budget_alerts", ARRAY[$2::text],
                    COALESCE("ai_organization_settings"."budget_alerts" -> $2, '[]'::jsonb) || to_jsonb($3::int))
            WHERE NOT COALESCE("ai_organization_settings"."budget_alerts" -> $2, '[]'::jsonb) @> to_jsonb($3::int)
           RETURNING 1`,
          [organizationId, month, threshold],
        )) as unknown[];
        if (!claimed.length) continue;
        this.events.emit(AI_BUDGET_THRESHOLD, {
          organizationId,
          percent: threshold,
          month,
          spentUsd: Math.round(spent.monthUsd * 100) / 100,
          budgetUsd: settings.monthlyBudgetUsd,
        } satisfies AiBudgetThresholdEvent);
      }
    } catch (error) {
      // A notice that could not be sent must never fail the call that was already paid for.
      this.logger.warn(`AI budget check after a call failed: ${(error as Error).message}`);
    }
  }

  private maxMonthlyBudget(): number {
    return this.config.get<number>('AI_MAX_MONTHLY_BUDGET_USD') ?? 10_000;
  }
}
