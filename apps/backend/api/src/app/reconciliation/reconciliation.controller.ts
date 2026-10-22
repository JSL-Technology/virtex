import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationAssistService } from './reconciliation-assist.service';
import { MatchOrigin } from './entities/reconciliation-match.entity';
import { ReconciliationSettingsDto } from './dto/reconciliation-settings.dto';
import { ApplyCategoryDto, ReconciliationAccountSettingsDto } from './dto/reconciliation-autopilot.dto';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { spooledUploadPath } from '../common/interfaces/fastify-file.interface';
import { readFile } from 'fs/promises';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UploadStatementDto } from './dto/upload-statement.dto';
import { ConfirmMatchDto } from './dto/confirm-match.dto';
import { ExcludeTransactionDto } from './dto/exclude-transaction.dto';
import { ReopenStatementDto } from './dto/reopen-statement.dto';
import {
  CreateReconciliationRuleDto,
  UpdateReconciliationRuleDto,
} from './dto/reconciliation-rule.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AI_RATE_LIMIT, TenantRateLimit, TenantRateLimitGuard } from '../shared/rate-limit/tenant-rate-limit.guard';

/**
 * The reconciliation surface.
 *
 * Three routes existed: upload, list statements, and a view. The one operation the module was for —
 * confirming a match — had a service method and a DTO but no route, so nothing could reach it.
 * There was no way to undo a match, to set a line aside, to close a reconciliation, or to create
 * the rules the auto-matcher iterated.
 */
@ApiTags('Bank Reconciliation')
@ApiBearerAuth()
@Controller('reconciliation')
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly assist: ReconciliationAssistService,
  ) {}

  // ── settings and assistance ───────────────────────────────────────────────

  @Get('settings')
  @HasPermission(PERMISSIONS.RECONCILIATION_VIEW)
  @ApiOperation({ summary: 'Whether safe matches are confirmed on import, and from what score.' })
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.reconciliation.settings(user.organizationId);
  }

  @Patch('settings')
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReconciliationSettingsDto) {
    return this.reconciliation.updateSettings(user.organizationId, dto);
  }

  /**
   * Which column of a CSV is which, proposed from its headers and sample rows (and, when the
   * headers say nothing usable, by the AI). Imports nothing; the person confirms the mapping.
   */
  @TenantRateLimit(AI_RATE_LIMIT)
  @UseGuards(TenantRateLimitGuard)
  @Post('column-mapping')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_IMPORT)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FastifyFileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async columnMapping(@UploadedFile() file: FastifyFile, @CurrentUser() user: AuthenticatedUser) {
    if (!file) throw new BadRequestError('users.file_required');
    const spooled = spooledUploadPath(file);
    const bytes = file.buffer ?? (spooled ? await readFile(spooled) : null);
    if (!bytes?.length) throw new BadRequestError('reconciliation.uploaded_file_empty_could_not_read');
    return this.assist.proposeMapping(user.organizationId, user.id, bytes);
  }

  @Get('bank-accounts/:bankAccountId/settings')
  @HasPermission(PERMISSIONS.RECONCILIATION_VIEW)
  @ApiOperation({ summary: "One account's settings in effect: confirmed without a person or not, the calibrated threshold, and whether it is paused." })
  accountSettings(@Param('bankAccountId', UuidParamPipe) bankAccountId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reconciliation.effectiveSettings(user.organizationId, bankAccountId);
  }

  @Patch('bank-accounts/:bankAccountId/settings')
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({ summary: "Set one account's own settings, or resume it after a pause." })
  updateAccountSettings(
    @Param('bankAccountId', UuidParamPipe) bankAccountId: string,
    @Body() dto: ReconciliationAccountSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.updateAccountSettings(user.organizationId, bankAccountId, dto, user.id);
  }

  @Post('statements/:id/undo-automatic')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({ summary: 'Undo every match of the statement confirmed without a person.' })
  undoAutomatic(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reconciliation.undoAutomatic(id, user.organizationId, user.id);
  }

  @Get('statements/:id/categories')
  @HasPermission(PERMISSIONS.RECONCILIATION_VIEW)
  @ApiOperation({ summary: 'For bank lines with nothing to match, the account they most likely belong to (learned from this company).' })
  categories(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reconciliation.categorySuggestions(id, user.organizationId);
  }

  @Post('statements/:id/transactions/:transactionId/categorize')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({ summary: 'Book an unexplained bank line to an account, and match it.' })
  async categorize(
    @Param('id', UuidParamPipe) id: string,
    @Param('transactionId', UuidParamPipe) transactionId: string,
    @Body() dto: ApplyCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // What was suggested is worked out here, not taken from the client: it is what the record keeps.
    const suggestion = (await this.reconciliation.categorySuggestions(id, user.organizationId)).find((item) => item.bankTransactionId === transactionId);
    return this.reconciliation.applyCategory(
      id,
      transactionId,
      dto.accountId,
      user.organizationId,
      user.id,
      suggestion ? { probability: suggestion.probability, suggestedAccountId: suggestion.accountId } : null,
    );
  }

  @Post('statements/:id/apply-safe')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({ summary: 'Confirm every unambiguous suggestion of the statement.' })
  applySafe(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reconciliation.applySafeMatches(id, user.organizationId, user.id, MatchOrigin.MANUAL);
  }

  /** Several exact-amount candidates the score cannot separate: ask the AI which one, and why. */
  @TenantRateLimit(AI_RATE_LIMIT)
  @UseGuards(TenantRateLimitGuard)
  @Post('statements/:id/transactions/:transactionId/resolve')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async resolve(
    @Param('id', UuidParamPipe) id: string,
    @Param('transactionId', UuidParamPipe) transactionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const suggestion = (await this.reconciliation.suggestMatches(id, user.organizationId)).find(
      (item) => item.bankTransactionId === transactionId,
    );
    if (!suggestion) throw new NotFoundError('reconciliation.transaction_not_found');
    const candidates = suggestion.candidates.slice(0, 5);
    if (candidates.length < 2) throw new BadRequestError('reconciliation.nothing_to_resolve');
    const statement = await this.reconciliation.findStatement(id, user.organizationId);
    const line = statement.transactions.find((transaction) => transaction.id === transactionId);
    return this.assist.resolveAmbiguous(
      user.organizationId,
      user.id,
      { date: suggestion.date, description: suggestion.description, reference: line?.reference ?? null, amount: suggestion.amount },
      candidates.map((candidate) => ({
        id: candidate.journalEntryLineId,
        date: candidate.date,
        description: candidate.description,
        amount: candidate.amount,
        entryNumber: candidate.entryNumber,
      })),
    );
  }

  // ── rules ──────────────────────────────────────────────────────────────────
  //
  // Declared before `statements/:id` so `rules` is never captured as a statement id.

  @Get('rules')
  @HasPermission(PERMISSIONS.RECONCILIATION_VIEW)
  @ApiOperation({ summary: 'Lista las reglas de conciliación de la organización.' })
  listRules(@CurrentUser() user: AuthenticatedUser) {
    return this.reconciliation.listRules(user.organizationId);
  }

  @Post('rules')
  @HasPermission(PERMISSIONS.RECONCILIATION_MANAGE_RULES)
  @ApiOperation({ summary: 'Crea una regla de conciliación.' })
  createRule(
    @Body() dto: CreateReconciliationRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.createRule(dto, user.organizationId);
  }

  @Patch('rules/:id')
  @HasPermission(PERMISSIONS.RECONCILIATION_MANAGE_RULES)
  updateRule(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateReconciliationRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.updateRule(id, dto, user.organizationId);
  }

  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.RECONCILIATION_MANAGE_RULES)
  deleteRule(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.deleteRule(id, user.organizationId);
  }

  // ── statements ─────────────────────────────────────────────────────────────

  @Post('statements')
  @HasPermission(PERMISSIONS.RECONCILIATION_IMPORT)
  @UseInterceptors(FastifyFileInterceptor('file'))
  @ApiOperation({ summary: 'Importa un estado de cuenta bancario (CSV, OFX o camt.053).' })
  importStatement(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          // CSV, OFX (often served as text/plain or octet-stream) or camt.053 XML; the content
          // decides which, not the declared type.
          new FileTypeValidator({ fileType: /(csv|xml|ofx|plain|octet-stream|vnd\.ms-excel)/ }),
        ],
      }),
    )
    file: FastifyFile,
    @Body() dto: UploadStatementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.importStatement(file, dto, user.organizationId, user.id);
  }

  @Get('statements')
  @HasPermission(PERMISSIONS.RECONCILIATION_VIEW)
  @ApiOperation({ summary: 'Lista los estados de cuenta importados.' })
  @ApiQuery({ name: 'bankAccountId', required: false, type: String })
  listStatements(
    @CurrentUser() user: AuthenticatedUser,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.reconciliation.listStatements(user.organizationId, bankAccountId);
  }

  @Get('statements/:id')
  @HasPermission(PERMISSIONS.RECONCILIATION_VIEW)
  findStatement(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.findStatement(id, user.organizationId);
  }

  /**
   * The proof: adjusted book balance against adjusted bank balance.
   *
   * The statement's opening and closing balances were columns nothing ever read, so no part of the
   * product could say whether an account actually reconciled.
   */
  @Get('statements/:id/summary')
  @HasPermission(PERMISSIONS.RECONCILIATION_VIEW)
  @ApiOperation({ summary: 'Cuadre de la conciliación: saldos ajustados y diferencia.' })
  summary(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.summary(id, user.organizationId);
  }

  @Get('statements/:id/suggestions')
  @HasPermission(PERMISSIONS.RECONCILIATION_VIEW)
  @ApiOperation({
    summary: 'Propone, para cada movimiento del banco, las líneas contables que podrían serlo.',
  })
  suggestions(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.suggestMatches(id, user.organizationId);
  }

  @Get('statements/:id/matches')
  @HasPermission(PERMISSIONS.RECONCILIATION_VIEW)
  listMatches(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.listMatches(id, user.organizationId);
  }

  @Post('statements/:id/apply-rules')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({ summary: 'Aplica las reglas activas al estado de cuenta.' })
  applyRules(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.applyRules(id, user.organizationId, user.id);
  }

  @Post('statements/:id/close')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({ summary: 'Cierra la conciliación. Sólo con diferencia cero.' })
  close(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.closeStatement(id, user.organizationId, user.id);
  }

  /**
   * Reopen a reconciled statement.
   *
   * The reason is required. Reopening reverses a control that somebody signed off, and an
   * unexplained reversal is not reviewable — the previous version not only asked for no reason, it
   * erased the record of the closing it was undoing.
   */
  @Post('statements/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  reopen(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: ReopenStatementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.reopenStatement(id, user.organizationId, user.id, dto.reason);
  }

  // ── matching ───────────────────────────────────────────────────────────────

  /**
   * Confirm a match.
   *
   * The operation the whole module is for. Its service method existed, its DTO existed, and no
   * controller route ever reached it.
   */
  @Post('matches')
  @HttpCode(HttpStatus.CREATED)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({
    summary: 'Concilia un grupo de movimientos bancarios contra un grupo de líneas contables.',
  })
  confirmMatch(@Body() dto: ConfirmMatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reconciliation.confirmMatch(dto, user.organizationId, user.id);
  }

  @Delete('matches/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({ summary: 'Deshace una conciliación.' })
  unmatch(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.unmatch(id, user.organizationId, user.id);
  }

  @Post('transactions/:id/exclude')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({ summary: 'Aparta un movimiento del banco del cuadre, con motivo.' })
  exclude(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: ExcludeTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.excludeTransaction(id, dto, user.organizationId);
  }
}
