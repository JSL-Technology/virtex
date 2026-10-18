import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CheckFeature } from '../saas/contracts/entitlements.contract';
import { CollectionsService } from './collections.service';
import {
  CollectionsWorklistQueryDto,
  ComposeReminderDto,
  LogCollectionActivityDto,
  SaveReminderDraftDto,
  SendReminderDto,
} from './dto/collections.dto';

/**
 * Sales › Collections. Reading needs the receivables permission as well as collections': the
 * worklist is the receivables book, ranked.
 */
@ApiTags('Collections')
@ApiBearerAuth()
@Controller('collections')
@HasPermission(PERMISSIONS.AI_COLLECTIONS_VIEW, PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW)
@CheckFeature('ai_collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get('worklist')
  @ApiOperation({ summary: 'Open invoices ranked by who to chase first, with the suggested action and why.' })
  worklist(@CurrentUser() user: AuthenticatedUser, @Query() query: CollectionsWorklistQueryDto) {
    return this.collections.worklist(user.organizationId, user.id, query);
  }

  @Get('invoices/:invoiceId/activities')
  invoiceActivities(@Param('invoiceId', UuidParamPipe) invoiceId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.collections.activitiesForInvoice(user.organizationId, user.id, invoiceId);
  }

  @Get('customers/:customerId/activities')
  customerActivities(@Param('customerId', UuidParamPipe) customerId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.collections.activitiesForCustomer(user.organizationId, customerId);
  }

  @Post('activities')
  @HasPermission(PERMISSIONS.AI_COLLECTIONS_ACT, PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW)
  @ApiOperation({ summary: 'Record a call, a payment promise or a note.' })
  log(@CurrentUser() user: AuthenticatedUser, @Body() dto: LogCollectionActivityDto) {
    return this.collections.log(user.organizationId, user.id, dto);
  }

  /** The assistant's note for a reminder, for the person to edit. Sends nothing. */
  @Post('invoices/:invoiceId/reminder/compose')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.AI_COLLECTIONS_ACT, PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  compose(
    @Param('invoiceId', UuidParamPipe) invoiceId: string,
    @Body() dto: ComposeReminderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collections.composeReminder(user.organizationId, user, invoiceId, dto.tone);
  }

  @Post('invoices/:invoiceId/reminder/draft')
  @HasPermission(PERMISSIONS.AI_COLLECTIONS_ACT, PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW)
  saveDraft(
    @Param('invoiceId', UuidParamPipe) invoiceId: string,
    @Body() dto: SaveReminderDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collections.saveDraft(user.organizationId, user.id, invoiceId, dto);
  }

  @Post('invoices/:invoiceId/reminder/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @HasPermission(PERMISSIONS.AI_COLLECTIONS_ACT, PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW)
  @UseGuards(ThrottlerGuard)
  // Renders a PDF and queues mail on every call.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  send(
    @Param('invoiceId', UuidParamPipe) invoiceId: string,
    @Body() dto: SendReminderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collections.sendReminder(user.organizationId, { id: user.id, email: user.email }, invoiceId, dto);
  }

  @Delete('drafts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.AI_COLLECTIONS_ACT, PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW)
  async cancelDraft(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.collections.cancelDraft(user.organizationId, user.id, id);
  }
}
