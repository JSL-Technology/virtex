/**
 * What the AI features let a person do.
 *
 * Kept with the catalogue rather than in `ai/`: the catalogue is platform, and platform depends on
 * no domain — a permission name is a string the role editor needs, not a reason for it to import
 * the AI module.
 *
 * Reading a forecast and starting a run are separate because a run spends compute and replaces the
 * figures everybody else is reading. Resolving an anomaly is separate from seeing it because
 * dismissing one is a judgement about somebody else's transaction.
 */
export const AI_PERMISSIONS = {
  AI_FORECASTS_VIEW: 'ai_forecasts:view',
  AI_FORECASTS_RUN: 'ai_forecasts:run',
  AI_ANOMALIES_VIEW: 'ai_anomalies:view',
  AI_ANOMALIES_RESOLVE: 'ai_anomalies:resolve',
  AI_VISION_USE: 'ai_vision:use',
  AI_USAGE_VIEW: 'ai_usage:view',
  /**
   * Talking to the copilot. What it can then see or draft is still governed, tool by tool, by the
   * user's own permissions — this only opens the conversation.
   */
  AI_COPILOT_USE: 'ai_copilot:use',
  /** Reading a supplier's invoice from a photo or PDF into a draft bill. Spends credits. */
  AI_BILL_CAPTURE_USE: 'ai_bill_capture:use',
  /** The projected cash flow and its what-if scenarios. Reveals every open balance, both sides. */
  AI_CASHFLOW_VIEW: 'ai_cashflow:view',
  /** The collections worklist (who to chase first, and why). */
  AI_COLLECTIONS_VIEW: 'ai_collections:view',
  /** Recording collection activity and sending reminders to customers. */
  AI_COLLECTIONS_ACT: 'ai_collections:act',
  /** The manager's monthly report and scenario comparisons. */
  AI_REPORTS_VIEW: 'ai_reports:view',
  /** Configuring the agents that prepare documents on their own, and reading their log. */
  AI_AGENTS_MANAGE: 'ai_agents:manage',
} as const;
