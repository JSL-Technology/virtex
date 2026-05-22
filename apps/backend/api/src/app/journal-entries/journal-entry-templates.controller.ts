
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

@Controller('journal-entry-templates')
@UseGuards(JwtAuthGuard)
export class JournalEntryTemplatesController {
  constructor(private readonly templatesService: JournalEntryTemplatesService) {}

  @Post()
  create(@Body() createDto: CreateJournalEntryTemplateDto, @CurrentUser() user: User) {
    return this.templatesService.create(createDto, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.templatesService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.templatesService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateJournalEntryTemplateDto,
    @CurrentUser() user: User,
  ) {
    return this.templatesService.update(id, updateDto, user.organizationId);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.templatesService.remove(id, user.organizationId);
  }


  @Post(':id/create-entry')
  @HttpCode(HttpStatus.CREATED)
  createEntryFromTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() createEntryDto: CreateJournalEntryFromTemplateDto,
    @CurrentUser() user: User,
  ) {
    return this.templatesService.createEntryFromTemplate(id, createEntryDto, user.organizationId);
  }
}