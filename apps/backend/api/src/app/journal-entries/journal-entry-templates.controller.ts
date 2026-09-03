
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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { JournalEntryTemplatesService } from './journal-entry-templates.service';
import { CreateJournalEntryTemplateDto, UpdateJournalEntryTemplateDto, CreateJournalEntryFromTemplateDto } from './dto/recurring-and-templates.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('journal-entry-templates')
@UseGuards(JwtAuthGuard)
export class JournalEntryTemplatesController {
  constructor(private readonly templatesService: JournalEntryTemplatesService) {}

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  @Post()
  create(@Body() createDto: CreateJournalEntryTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templatesService.create(createDto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.templatesService.findAll(user.organizationId);
  }

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templatesService.findOne(id, user.organizationId);
  }

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_EDIT)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateJournalEntryTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.update(id, updateDto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_EDIT)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templatesService.remove(id, user.organizationId);
  }


  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  @Post(':id/create-entry')
  @HttpCode(HttpStatus.CREATED)
  createEntryFromTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() createEntryDto: CreateJournalEntryFromTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.createEntryFromTemplate(id, createEntryDto, user.organizationId,
      user.id,);
  }
}