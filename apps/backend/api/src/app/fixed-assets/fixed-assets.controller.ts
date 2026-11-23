import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { FixedAssetsService } from './fixed-assets.service';
import { DepreciationService } from './depreciation.service';
import { FixedAssetCategoriesService } from './fixed-asset-categories.service';
import { FixedAssetCapitalizationService } from './capitalization.service';
import { TaxBookService } from './tax-book.service';
import { resolvePaging } from '../common/pagination';
import { DepreciationRunTrigger } from './entities/fixed-asset-depreciation-run.entity';
import {
  CreateFixedAssetDto,
  DepreciationRunDto,
  DepreciationRunsQueryDto,
  DisposeAssetDto,
  CapitalizationDto,
  CapitalizationSourcesQueryDto,
  FixedAssetReconciliationListQueryDto,
  FixedAssetReconciliationQueryDto,
  FixedAssetsQueryDto,
  TaxDepreciationReportQueryDto,
  UpdateFixedAssetDto,
} from './dto/fixed-asset.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';

/**
 * The fixed-asset register and its depreciation.
 *
 * Every route declares its permission: acquiring, editing and disposing of an asset, and running
 * depreciation, all reach the general ledger. They were once open to any member of the tenant.
 */
@Controller('fixed-assets')
export class FixedAssetsController {
  constructor(
    private readonly fixedAssetsService: FixedAssetsService,
    private readonly depreciation: DepreciationService,
    private readonly categories: FixedAssetCategoriesService,
    private readonly taxBooks: TaxBookService,
    private readonly capitalization: FixedAssetCapitalizationService,
  ) {}

  /**
   * The purchases and entries that debited a fixed-asset account and still have cost to register
   * as an asset: what is waiting to be registered (FINB-15).
   */
  @Get('capitalization-sources')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  capitalizationSources(@Query() query: CapitalizationSourcesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.capitalization.sources(user.organizationId, resolvePaging(query.page, query.pageSize), {
      accountId: query.accountId,
      search: query.search,
      vendorBillId: query.vendorBillId,
      journalEntryId: query.journalEntryId,
    });
  }

  /** The register against the ledger on a day, account by account, and what explains the difference. */
  @Get('reconciliation')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  reconciliation(@Query() query: FixedAssetReconciliationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.capitalization.reconciliation(user.organizationId, query.asOf);
  }

  /** The assets whose cost is not in the ledger on the day, and why, by page. */
  @Get('reconciliation/unlinked-assets')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  reconciliationUnlinkedAssets(@Query() query: FixedAssetReconciliationListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.capitalization.unlinkedAssets(user.organizationId, query.asOf, resolvePaging(query.page, query.pageSize));
  }

  /** What the ledger moved on the register's accounts by the day with no asset behind it, by page. */
  @Get('reconciliation/untraced-postings')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  reconciliationUntracedPostings(@Query() query: FixedAssetReconciliationListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.capitalization.untracedPostings(user.organizationId, query.asOf, resolvePaging(query.page, query.pageSize));
  }

  // Declared before `:id`, so `depreciation-runs`, `tax-categories` and `tax-depreciation` are
  // never read as an asset id.

  /** The tax categories the company's market fixes, and their rates; null where it fixes none. */
  @Get('tax-categories')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  taxCategories(@CurrentUser() user: AuthenticatedUser) {
    return this.categories.taxCatalogue(user.organizationId);
  }

  /**
   * The tax depreciation of a period: each asset's basis, what was deducted before and in it, what
   * is left, and the temporary difference against the accounting book (FINB-16).
   */
  @Get('tax-depreciation')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  taxDepreciation(@Query() query: TaxDepreciationReportQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.taxBooks.report(
      user.organizationId,
      query.from,
      query.to,
      resolvePaging(query.page, query.pageSize),
      query.taxCategoryCode,
    );
  }

  /** What a run for the month would charge, asset by asset, without posting. */
  @Get('depreciation-runs/preview')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  previewDepreciation(@Query() query: DepreciationRunDto, @CurrentUser() user: AuthenticatedUser) {
    return this.depreciation.preview(user.organizationId, `${query.period}-01`);
  }

  /** The runs that charged something, newest first: when, why, who, and how much. */
  @Get('depreciation-runs')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  listRuns(@Query() query: DepreciationRunsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.depreciation.listRuns(user.organizationId, query);
  }

  /** One run: every asset-month it charged, and the entries that carry them. */
  @Get('depreciation-runs/:runId')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  findRun(@Param('runId', UuidParamPipe) runId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.depreciation.findRun(runId, user.organizationId);
  }

  /**
   * Charge every asset everything it is due through the month. Idempotent by construction: a month
   * already charged is not charged again, whoever ran it. A month that has not ended is refused.
   */
  @Post('depreciation-runs')
  @Idempotent()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  runDepreciation(@Body() dto: DepreciationRunDto, @CurrentUser() user: AuthenticatedUser) {
    return this.depreciation.runMonthlyDepreciation(user.organizationId, `${dto.period}-01`, {
      trigger: DepreciationRunTrigger.MANUAL,
      ranByUserId: user.id,
    });
  }

  @Post()
  @Idempotent()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  create(@Body() dto: CreateFixedAssetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.fixedAssetsService.create(dto, user.organizationId, user.id);
  }

  @Get()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: FixedAssetsQueryDto) {
    return this.fixedAssetsService.findAll(user.organizationId, query);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fixedAssetsService.findOne(id, user.organizationId);
  }

  /** The depreciation board: months charged, and the projection of the rest. */
  @Get(':id/schedule')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  schedule(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fixedAssetsService.schedule(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateFixedAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fixedAssetsService.update(id, dto, user.organizationId, user.id);
  }

  /** Record, or correct, how the asset's cost entered the ledger (FINB-15). */
  @Post(':id/capitalization')
  @Idempotent()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  capitalize(@Param('id', UuidParamPipe) id: string, @Body() dto: CapitalizationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.fixedAssetsService.capitalize(id, dto, user.organizationId, user.id);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fixedAssetsService.remove(id, user.organizationId, user.id);
  }

  @Post(':id/dispose')
  @Idempotent()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_DISPOSE)
  dispose(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: DisposeAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fixedAssetsService.dispose(id, dto, user.organizationId, user.id);
  }
}
