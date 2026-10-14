import { Logger } from '@nestjs/common';
import { OnQueueEvent, QueueEventsHost, QueueEventsListener } from '@nestjs/bullmq';
import { AI_ENGINE_QUEUE } from './engine-runs.service';
import { AiRunNotifierService } from './ai-run-notifier.service';

/** What the Python worker returns for a job: the run's final status and whose run it was. */
interface EngineJobResult {
  status?: string;
  runId?: string;
  organizationId?: string;
}

/**
 * Hears the engine finish a run — the job's `completed` event, published by BullMQ — and hands it
 * to the notifier straight away, rather than waiting for a sweep.
 *
 * Every API replica hears every completion; the notifier's claim makes sure one announces it.
 */
@QueueEventsListener(AI_ENGINE_QUEUE)
export class AiEngineEventsListener extends QueueEventsHost {
  private readonly logger = new Logger(AiEngineEventsListener.name);

  constructor(private readonly notifier: AiRunNotifierService) {
    super();
  }

  @OnQueueEvent('completed')
  async onCompleted({ returnvalue }: { jobId: string; returnvalue: unknown }): Promise<void> {
    const result = parse(returnvalue);
    if (result?.status !== 'SUCCEEDED' || !result.runId || !result.organizationId) return;
    try {
      await this.notifier.announce(result.organizationId, result.runId);
    } catch (error) {
      // The sweep will pick it up; a failed notice never fails anything else.
      this.logger.warn(`Run ${result.runId} finished but could not be announced yet: ${(error as Error).message}`);
    }
  }
}

function parse(value: unknown): EngineJobResult | null {
  if (value && typeof value === 'object') return value as EngineJobResult;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as EngineJobResult) : null;
  } catch {
    return null;
  }
}
