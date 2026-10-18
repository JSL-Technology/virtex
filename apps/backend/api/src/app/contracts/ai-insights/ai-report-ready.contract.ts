/**
 * A written report is ready to read — the manager's monthly report, generated in the background.
 *
 * Emitted by the AI module once the report is stored; the notifications module decides who is
 * told (those who may read it). Neither imports the other.
 */
export const AI_REPORT_READY = 'ai.report.ready';

export interface AiReportReadyEvent {
  organizationId: string;
  reportId: string;
  kind: 'MANAGER_MONTHLY';
  /** `YYYY-MM`. */
  period: string | null;
}
