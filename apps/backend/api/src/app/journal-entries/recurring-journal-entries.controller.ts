
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { RecurringJournalEntriesService } from './recurring-journal-entries.service';
import {
  CreateRecurringJournalEntryDto,
  UpdateRecurringJournalEntryDto,
} from './dto/recurring-and-templates.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('recurring-journal-entries')
@UseGuards(JwtAuthGuard)
export class RecurringJournalEntriesController {
  constructor(
    private readonly recurringService: RecurringJournalEntriesService,
  ) {}

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  @Post()
  create(
    @Body() createDto: CreateRecurringJournalEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recurringService.create(createDto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.recurringService.findAll(user.organizationId);
  }

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recurringService.findOne(id, user.organizationId);
  }

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_EDIT)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateRecurringJournalEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recurringService.update(id, updateDto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_EDIT)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recurringService.remove(id, user.organizationId);
  }
}

