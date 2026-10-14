import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AiRequest } from './entities/ai-request.entity';
import { AiModelRun } from './entities/ai-model-run.entity';
import { AiForecast } from './entities/ai-forecast.entity';
import { AiInventoryInsight } from './entities/ai-inventory-insight.entity';
import { AiAnomaly } from './entities/ai-anomaly.entity';
import { AiAnomalyFeedback } from './entities/ai-anomaly-feedback.entity';
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
@Module({
  imports: [
    TypeOrmModule.forFeature([AiRequest, AiModelRun, AiForecast, AiInventoryInsight, AiAnomaly, AiAnomalyFeedback]),
    BullModule.registerQueue({ name: AI_ENGINE_QUEUE }),
    InventoryModule,
  ],
  controllers: [AiController],
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
  ],
  exports: [AiGatewayService],
})
export class AiModule {}
