
import { Controller, Get, Post, Body } from '@nestjs/common';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { JournalsService } from './journals.service';
import { CreateJournalDto } from './dto/journal.dto';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('journals')
export class JournalsController {
  constructor(private readonly journalsService: JournalsService) {}

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  @Post()
  create(@Body() createJournalDto: CreateJournalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.journalsService.create(createJournalDto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTING_MANAGE_LEDGERS)
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.journalsService.findAll(user.organizationId);
  }
}