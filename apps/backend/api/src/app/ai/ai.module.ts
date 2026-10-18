import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AiRequest } from './entities/ai-request.entity';
import { AiModelRun } from './entities/ai-model-run.entity';
import { AiForecast } from './entities/ai-forecast.entity';
import { AiInventoryInsight } from './entities/ai-inventory-insight.entity';
import { AiAnomaly } from './entities/ai-anomaly.entity';
import { AiAnomalyFeedback } from './entities/ai-anomaly-feedback.entity';
import { AiConversation } from './entities/ai-conversation.entity';
import { AiMessage } from './entities/ai-message.entity';
import { AiPendingAction } from './entities/ai-pending-action.entity';
import { CopilotService } from './copilot/copilot.service';
import { CopilotController } from './copilot/copilot.controller';
import { AiCopilotTools } from './copilot/ai.copilot-tools';
import { HelpService } from './help/help.service';
import { CashflowService } from './cashflow/cashflow.service';
import { PaymentLikelihoodProvider } from './cashflow/payment-likelihood.provider';
import { CashflowController } from './cashflow/cashflow.controller';
import { CashflowPlanBuilder } from './cashflow/cashflow-plan.builder';
import { ReportsService, AI_REPORTS_QUEUE } from './reports/reports.service';
import { ReportsProcessor } from './reports/reports.processor';
import { AiCashflowForecast } from './entities/ai-cashflow-forecast.entity';
import { AiCashflowItem } from './entities/ai-cashflow-item.entity';
import { AiReport } from './entities/ai-report.entity';
import { AiKnowledgeChunk } from './entities/ai-knowledge-chunk.entity';
import { AiAssistPort } from '../contracts/ai/ai-assist.contract';
import { AiGatewayService } from './gateway/ai-gateway.service';
import { EmbeddingsService } from './embeddings/embeddings.service';
import { ProductVisionService } from './product-vision/product-vision.service';
import { BarcodeLookupService } from './product-vision/barcode-lookup.service';
import { EngineRunsService, AI_ENGINE_QUEUE } from './engine/engine-runs.service';
import { AiSchedulerService } from './engine/ai-scheduler.service';
import { AiRunNotifierService } from './engine/ai-run-notifier.service';
import { AiEngineEventsListener } from './engine/ai-engine-events.listener';
import { ForecastingService } from './forecasting/forecasting.service';
import { AnomaliesService } from './anomalies/anomalies.service';
import { AiController } from './ai.controller';
import { InventoryModule } from '../inventory/inventory.module';

/**
 * The AI platform: the gateway every model call goes through, photo-assisted catalogue entry, and
 * the API side of forecasting and anomaly detection (the engine itself is `apps/ai-engine`).
 *
 * It owns only the `ai_*` tables. The catalogue is reached through `ProductCatalogPort`, and the
 * plan through `EntitlementsPort`, so nothing here depends on how either is implemented.
 */
// Global for one export: `AiAssistPort`, which domain modules inject without importing this module
// (they may not — see contracts/ai/ai-assist.contract.ts).
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiRequest, AiModelRun, AiForecast, AiInventoryInsight, AiAnomaly, AiAnomalyFeedback,
      AiConversation, AiMessage, AiPendingAction, AiKnowledgeChunk,
      AiCashflowForecast, AiCashflowItem, AiReport,
    ]),
    BullModule.registerQueue({ name: AI_ENGINE_QUEUE }),
    BullModule.registerQueue({ name: AI_REPORTS_QUEUE }),
    InventoryModule,
  ],
  controllers: [AiController, CopilotController, CashflowController],
  providers: [
    AiGatewayService,
    EmbeddingsService,
    ProductVisionService,
    BarcodeLookupService,
    EngineRunsService,
    AiSchedulerService,
    AiRunNotifierService,
    AiEngineEventsListener,
    ForecastingService,
    AnomaliesService,
    CopilotService,
    HelpService,
    CashflowService,
    PaymentLikelihoodProvider,
    ReportsService,
    ReportsProcessor,
    CashflowPlanBuilder,
    AiCopilotTools,
    { provide: AiAssistPort, useExisting: AiGatewayService },
  ],
  exports: [AiGatewayService, AiAssistPort],
})
export class AiModule {}
