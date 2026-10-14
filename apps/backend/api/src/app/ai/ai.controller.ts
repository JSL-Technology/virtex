import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import * as fs from 'fs/promises';
import { DataSource } from 'typeorm';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile, spooledUploadPath } from '../common/interfaces/fastify-file.interface';
import { BadRequestError } from '../i18n/localized.exception';
import { CheckFeature, EntitlementsPort } from '../saas/contracts/entitlements.contract';
import { ProductVisionService } from './product-vision/product-vision.service';
import { BarcodeLookupService } from './product-vision/barcode-lookup.service';
import { ForecastingService } from './forecasting/forecasting.service';
import { AnomaliesService } from './anomalies/anomalies.service';
import { EngineRunsService } from './engine/engine-runs.service';
import { AiGatewayService } from './gateway/ai-gateway.service';
import { EmbeddingsService } from './embeddings/embeddings.service';
import {
  AnomaliesQueryDto,
  AnomalyFeedbackDto,
  InsightsQueryDto,
  SeriesQueryDto,
  TopByBranchQueryDto,
} from './dto/ai-queries.dto';

/** The largest photo accepted. A phone's full-resolution JPEG is 3–8 MB; the image is resized anyway. */
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

/**
 * The AI features, over HTTP.
 *
 * Each route states three things: the permission a person needs, the plan capability the tenant
 * needs (`@CheckFeature`), and — on the routes that call a model — a rate limit, because one
 * person scripting the endpoint should not be able to drain the whole tenant's monthly credits in a
 * minute.
 */
@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly vision: ProductVisionService,
    private readonly barcodes: BarcodeLookupService,
    private readonly forecasting: ForecastingService,
    private readonly anomalies: AnomaliesService,
    private readonly runs: EngineRunsService,
    private readonly gateway: AiGatewayService,
    private readonly embeddings: EmbeddingsService,
    private readonly entitlements: EntitlementsPort,
    private readonly dataSource: DataSource,
  ) {}

  // ── Status ─────────────────────────────────────────────────────────────────────

  @Get('status')
  @AuthenticatedOnly(
    'Tells the client which AI buttons to show. It reveals what the tenant\'s plan includes and\n' +
      'whether the provider is reachable — nothing about any record.',
  )
  @ApiOperation({ summary: 'Which AI features are available to this tenant right now.' })
  async status(@CurrentUser() user: AuthenticatedUser) {
    const [vision, forecasting, anomalies] = await Promise.all([
      this.entitlements.checkFeature(user.organizationId, 'ai_vision'),
      this.entitlements.checkFeature(user.organizationId, 'ai_forecasting'),
      this.entitlements.checkFeature(user.organizationId, 'ai_anomalies'),
    ]);
    const languageModel = this.gateway.isAvailable();
    return {
      vision: { enabledByPlan: vision, available: vision && languageModel },
      forecasting: { enabledByPlan: forecasting, available: forecasting },
      anomalies: { enabledByPlan: anomalies, available: anomalies, explanations: anomalies && languageModel },
      duplicateImageSearch: this.embeddings.isAvailable(),
    };
  }

  @Get('usage')
  @HasPermission(PERMISSIONS.AI_USAGE_VIEW)
  @ApiOperation({ summary: 'AI calls this month: count, credits and estimated cost, by feature.' })
  async usage(@CurrentUser() user: AuthenticatedUser) {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT "feature", "status", COUNT(*)::int AS "calls", COALESCE(SUM("credits"), 0)::int AS "credits",
              COALESCE(SUM("cost_micro_usd"), 0)::bigint AS "costMicroUsd",
              COALESCE(SUM("input_tokens"), 0)::bigint AS "inputTokens",
              COALESCE(SUM("output_tokens"), 0)::bigint AS "outputTokens"
         FROM "ai_requests"
        WHERE "organization_id" = $1 AND "created_at" >= date_trunc('month', now())
        GROUP BY "feature", "status"
        ORDER BY "feature", "status"`,
      [user.organizationId],
    );
    return rows.map((row) => ({
      ...row,
      costMicroUsd: Number(row['costMicroUsd']),
      inputTokens: Number(row['inputTokens']),
      outputTokens: Number(row['outputTokens']),
    }));
  }

  // ── Product from photo ─────────────────────────────────────────────────────────

  @Post('products/from-image')
  @HasPermission(PERMISSIONS.PRODUCTS_CREATE, PERMISSIONS.AI_VISION_USE)
  @CheckFeature('ai_vision')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Propose a catalogue entry from a product photo. Stores the photo; creates no product.',
  })
  @UseInterceptors(
    FastifyFileInterceptor('file', {
      fileFilter: (_req, file, cb) => {
        // The declared type is only a first filter; the bytes are decoded before anything trusts them.
        if (!/^image\/(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.mimetype)) {
          return cb(new BadRequestError('inventory.product_image.not_an_image'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: MAX_PHOTO_BYTES },
    }),
  )
  async productFromImage(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: FastifyFile) {
    if (!file) throw new BadRequestError('users.file_required');
    const spooled = spooledUploadPath(file);
    try {
      const buffer = file.buffer ?? (spooled ? await fs.readFile(spooled) : null);
      if (!buffer?.length) throw new BadRequestError('users.file_required');
      return await this.vision.suggestFromImage(user.organizationId, user.id, {
        fileName: file.originalname ?? file.filename,
        mimeType: file.mimetype,
        buffer,
      });
    } finally {
      if (spooled) {
        await fs
          .unlink(spooled)
          .catch((error) => this.logger.warn(`Failed to remove temporary upload ${spooled}: ${error.message}`));
      }
    }
  }

  /**
   * What is known about a scanned barcode: the tenant's products that already carry it and, when
   * the deployment enabled it, a public reference. No model is involved and no credit is spent, so
   * it is not behind the AI plan feature — scanning is part of entering a product.
   */
  @Get('products/barcode/:code')
  @HasPermission(PERMISSIONS.PRODUCTS_CREATE)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Look a barcode up in the catalogue and, if enabled, in Open Food Facts.' })
  barcode(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string) {
    if (!/^[0-9A-Za-z-]{1,64}$/.test(code ?? '')) throw new BadRequestError('ai.barcode_invalid');
    return this.barcodes.lookup(user.organizationId, code);
  }

  // ── Forecasting ────────────────────────────────────────────────────────────────

  @Get('forecasts/summary')
  @HasPermission(PERMISSIONS.AI_FORECASTS_VIEW)
  @CheckFeature('ai_forecasting')
  @ApiOperation({ summary: 'Counts by inventory status, and the latest forecasting run.' })
  forecastSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.forecasting.summary(user.organizationId);
  }

  @Get('forecasts/insights')
  @HasPermission(PERMISSIONS.AI_FORECASTS_VIEW)
  @CheckFeature('ai_forecasting')
  @ApiOperation({ summary: 'Per product and warehouse: cover, stock-out date, reorder suggestion.' })
  insights(@CurrentUser() user: AuthenticatedUser, @Query() query: InsightsQueryDto) {
    return this.forecasting.insights(user.organizationId, query);
  }

  @Get('forecasts/top-by-branch')
  @HasPermission(PERMISSIONS.AI_FORECASTS_VIEW)
  @CheckFeature('ai_forecasting')
  @ApiOperation({ summary: 'Which products are projected to sell most in each branch over 30 days.' })
  topByBranch(@CurrentUser() user: AuthenticatedUser, @Query() query: TopByBranchQueryDto) {
    return this.forecasting.topByBranch(user.organizationId, query.perBranch);
  }

  @Get('forecasts/series')
  @HasPermission(PERMISSIONS.AI_FORECASTS_VIEW)
  @CheckFeature('ai_forecasting')
  @ApiOperation({ summary: 'Units sold, then the P10/P50/P90 forecast, for one product in one warehouse.' })
  series(@CurrentUser() user: AuthenticatedUser, @Query() query: SeriesQueryDto) {
    return this.forecasting.series(user.organizationId, query.productId, query.warehouseId, query.historyDays);
  }

  @Post('forecasts/runs')
  @HasPermission(PERMISSIONS.AI_FORECASTS_RUN)
  @CheckFeature('ai_forecasting')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue a forecasting run now. Returns the run already queued, if any.' })
  async runForecast(@CurrentUser() user: AuthenticatedUser) {
    const run = await this.runs.request(user.organizationId, 'FORECAST', 'MANUAL', user.id);
    return { id: run.id, status: run.status, createdAt: run.createdAt };
  }

  // ── Anomalies ──────────────────────────────────────────────────────────────────

  @Get('anomalies')
  @HasPermission(PERMISSIONS.AI_ANOMALIES_VIEW)
  @CheckFeature('ai_anomalies')
  @ApiOperation({ summary: 'The anomaly inbox, most severe first.' })
  listAnomalies(@CurrentUser() user: AuthenticatedUser, @Query() query: AnomaliesQueryDto) {
    return this.anomalies.list(user.organizationId, query);
  }

  @Get('anomalies/last-run')
  @HasPermission(PERMISSIONS.AI_ANOMALIES_VIEW)
  @CheckFeature('ai_anomalies')
  @ApiOperation({ summary: 'The latest anomaly-detection run.' })
  async lastAnomalyRun(@CurrentUser() user: AuthenticatedUser) {
    const run = await this.runs.latest(user.organizationId, 'ANOMALY');
    return run && { id: run.id, status: run.status, createdAt: run.createdAt, finishedAt: run.finishedAt, metrics: run.metrics };
  }

  @Post('anomalies/runs')
  @HasPermission(PERMISSIONS.AI_ANOMALIES_RESOLVE)
  @CheckFeature('ai_anomalies')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue an anomaly-detection run now.' })
  async runAnomalies(@CurrentUser() user: AuthenticatedUser) {
    const run = await this.runs.request(user.organizationId, 'ANOMALY', 'MANUAL', user.id);
    return { id: run.id, status: run.status, createdAt: run.createdAt };
  }

  @Post('anomalies/:id/feedback')
  @HasPermission(PERMISSIONS.AI_ANOMALIES_RESOLVE)
  @CheckFeature('ai_anomalies')
  @ApiOperation({ summary: 'Confirm a finding as useful, or dismiss it as a false positive.' })
  feedback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: AnomalyFeedbackDto,
  ) {
    return this.anomalies.recordFeedback(user.organizationId, user.id, id, dto.verdict, dto.comment ?? null);
  }

  @Post('anomalies/:id/reopen')
  @HasPermission(PERMISSIONS.AI_ANOMALIES_RESOLVE)
  @CheckFeature('ai_anomalies')
  @ApiOperation({ summary: 'Reopen a finding that was confirmed or dismissed.' })
  reopen(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.anomalies.reopen(user.organizationId, id);
  }

  @Post('anomalies/:id/explain')
  @HasPermission(PERMISSIONS.AI_ANOMALIES_VIEW)
  @CheckFeature('ai_anomalies')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Write (once) a plain-language explanation of a finding from its evidence.' })
  explain(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.anomalies.explain(user.organizationId, user.id, id);
  }
}
