import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { JournalsService } from './journals.service';
import { CreateJournalDto, UpdateJournalDto } from './dto/journal.dto';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';

/**
 * Journals (QA A-13).
 *
 * The permissions were inverted: creating a journal needed only to *view* entries, while listing
 * them — which every entry form does to fill its journal picker — needed to *manage ledgers*. Now
 * whoever reads entries can read the journals they belong to, and only a ledger manager changes
 * them. Reading one, editing and deleting it did not exist at all; the edit screen answered 404.
 */
@Controller('journals')
export class JournalsController {
  constructor(private readonly journalsService: JournalsService) {}

  @HasPermission(PERMISSIONS.ACCOUNTING_MANAGE_LEDGERS)
  @Post()
  create(@Body() dto: CreateJournalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.journalsService.create(dto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.journalsService.findAll(user.organizationId);
  }

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  @Get(':id')
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.journalsService.findOne(id, user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTING_MANAGE_LEDGERS)
  @Patch(':id')
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateJournalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalsService.update(id, dto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTING_MANAGE_LEDGERS)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.journalsService.remove(id, user.organizationId);
  }
}
