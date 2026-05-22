
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

@Controller('recurring-journal-entries')
@UseGuards(JwtAuthGuard)
export class RecurringJournalEntriesController {
  constructor(
    private readonly recurringService: RecurringJournalEntriesService,
  ) {}

  @Post()
  create(
    @Body() createDto: CreateRecurringJournalEntryDto,
    @CurrentUser() user: User,
  ) {
    return this.recurringService.create(createDto, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.recurringService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.recurringService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateRecurringJournalEntryDto,
    @CurrentUser() user: User,
  ) {
    return this.recurringService.update(id, updateDto, user.organizationId);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.recurringService.remove(id, user.organizationId);
  }
}

