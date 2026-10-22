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
import { AiChart } from './entities/ai-chart.entity';
import { CopilotService } from './copilot/copilot.service';
import { CopilotController, CopilotDataController } from './copilot/copilot.controller';
import { AiCopilotTools } from './copilot/ai.copilot-tools';
import { HelpService } from './help/help.service';
import { CashflowService } from './cashflow/cashflow.service';
import { PaymentLikelihoodProvider } from './cashflow/payment-likelihood.provider';
import { ManagerReportBuilder } from './reports/manager-report.builder';
import { ScenarioComparisonBuilder } from './cashflow/scenario-comparison.builder';
import { DataQualityService } from './data-quality/data-quality.service';
import { DataQualityController } from './data-quality/data-quality.controller';
import { AiDuplicateSuggestion } from './entities/ai-duplicate-suggestion.entity';
import { AiAgentRun } from './entities/ai-agent-run.entity';
import { AgentRunsService } from './agents/agent-runs.service';
import { AgentsController } from './agents/agents.controller';
import { ReorderSuggestionsProvider } from './forecasting/reorder-suggestions.provider';
import { AgentRunLogPort } from '../contracts/ai/agent-runs.contract';
import { ManagerReportController } from './reports/manager-report.controller';
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
import { AiOrganizationSettings } from './entities/ai-organization-settings.entity';
import { AiRecordProvenance } from './entities/ai-record-provenance.entity';
import { ProvenanceController } from './provenance/provenance.controller';
import { AiMessageFeedback } from './entities/ai-message-feedback.entity';
import { AiSettingsService } from './settings/ai-settings.service';
import { AiSettingsController } from './settings/ai-settings.controller';
import { AuditModule } from '../audit/audit.module';
import { AiRetentionService } from './settings/ai-retention.service';

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
      AiConversation, AiMessage, AiPendingAction, AiChart, AiKnowledgeChunk,
      AiCashflowForecast, AiCashflowItem, AiReport, AiDuplicateSuggestion, AiAgentRun, AiOrganizationSettings, AiRecordProvenance, AiMessageFeedback,
    ]),
    BullModule.registerQueue({ name: AI_ENGINE_QUEUE }),
    BullModule.registerQueue({ name: AI_REPORTS_QUEUE }),
    InventoryModule,
    AuditModule,
  ],
  controllers: [AiController, ProvenanceController, CopilotController, CopilotDataController, CashflowController, ManagerReportController, DataQualityController, AgentsController, AiSettingsController],
  providers: [
    AiSettingsService,
    AiRetentionService,
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
    ManagerReportBuilder,
    ScenarioComparisonBuilder,
    DataQualityService,
    AgentRunsService,
    ReorderSuggestionsProvider,
    { provide: AgentRunLogPort, useExisting: AgentRunsService },
    AiCopilotTools,
    { provide: AiAssistPort, useExisting: AiGatewayService },
  ],
  exports: [AiGatewayService, AiAssistPort, AgentRunLogPort],
})
export class AiModule {}
