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
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';
import { ReconciliationService } from './reconciliation.service';
import { UploadStatementDto } from './dto/upload-statement.dto';
import { ConfirmMatchDto } from './dto/confirm-match.dto';
import { ExcludeTransactionDto } from './dto/exclude-transaction.dto';
import {
  CreateReconciliationRuleDto,
  UpdateReconciliationRuleDto,
} from './dto/reconciliation-rule.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

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
@UseGuards(JwtAuthGuard)
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReconciliationRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.updateRule(id, dto, user.organizationId);
  }

  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.RECONCILIATION_MANAGE_RULES)
  deleteRule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.deleteRule(id, user.organizationId);
  }

  // ── statements ─────────────────────────────────────────────────────────────

  @Post('statements')
  @HasPermission(PERMISSIONS.RECONCILIATION_IMPORT)
  @UseInterceptors(FastifyFileInterceptor('file'))
  @ApiOperation({ summary: 'Importa un estado de cuenta bancario en CSV.' })
  importStatement(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: 'text/csv' }),
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
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.suggestMatches(id, user.organizationId);
  }

  @Get('statements/:id/matches')
  @HasPermission(PERMISSIONS.RECONCILIATION_VIEW)
  listMatches(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.listMatches(id, user.organizationId);
  }

  @Post('statements/:id/apply-rules')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({ summary: 'Aplica las reglas activas al estado de cuenta.' })
  applyRules(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.applyRules(id, user.organizationId, user.id);
  }

  @Post('statements/:id/close')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({ summary: 'Cierra la conciliación. Sólo con diferencia cero.' })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.closeStatement(id, user.organizationId, user.id);
  }

  @Post('statements/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.reopenStatement(id, user.organizationId);
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
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.unmatch(id, user.organizationId);
  }

  @Post('transactions/:id/exclude')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.RECONCILIATION_MATCH)
  @ApiOperation({ summary: 'Aparta un movimiento del banco del cuadre, con motivo.' })
  exclude(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExcludeTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.excludeTransaction(id, dto, user.organizationId);
  }
}
