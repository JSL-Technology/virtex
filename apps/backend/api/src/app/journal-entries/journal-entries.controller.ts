
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  Patch,
  Delete,
  StreamableFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFilesInterceptor } from '../common/interceptors/fastify-files.interceptor';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { PermissionsGuard } from '../auth/guards/permissions/permissions.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import {
  UpdateJournalEntryDto,
  ReverseJournalEntryDto,
} from './dto/journal-entry-actions.dto';
import { JournalEntryImportService } from './journal-entry-import.service';
import { ConfirmImportDto, PreviewImportRequestDto } from './dto/journal-entry-import.dto';
import { TemporalValidityGuard } from '../financial-reporting/guards/temporal-validity.guard';

@Controller('journal-entries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JournalEntriesController {
  constructor(
    private readonly journalEntriesService: JournalEntriesService,
    private readonly importService: JournalEntryImportService,
  ) {}

  @Post()
  @UseGuards(PeriodLockGuard, TemporalValidityGuard)
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  create(
    @Body() createJournalEntryDto: CreateJournalEntryDto,
    @CurrentUser() user: User,
  ) {
    return this.journalEntriesService.create(
      createJournalEntryDto,
      user.organizationId,
    );
  }

  @Get()
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  findAll(@CurrentUser() user: User) {
    return this.journalEntriesService.findAll(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.journalEntriesService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateJournalEntryDto,
    @CurrentUser() user: User,
  ) {
    return this.journalEntriesService.update(id, user.organizationId, updateDto);
  }

  @Post(':id/reverse')
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() reverseDto: ReverseJournalEntryDto,
    @CurrentUser() user: User,
  ) {
    return this.journalEntriesService.reverse(
      id,
      user.organizationId,
      reverseDto,
    );
  }
  
  @Post(':id/create-reversal')
  @HttpCode(HttpStatus.CREATED)
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  createReversal(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
      return this.journalEntriesService.createReversalEntry(id, user.organizationId);
  }


  @Post('import/preview')
  @UseInterceptors(FastifyFileInterceptor('file'))
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  previewImportFromCsv(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(text\/csv|spreadsheetml\.sheet)/ }),
        ],
      }),
    )
    file: FastifyFile,
    @Body() mapping: PreviewImportRequestDto,
    @CurrentUser() user: User,
  ) {
    return this.importService.preview(file, mapping, user.organizationId);
  }

  @Post('import/confirm')
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  confirmImport(
    @Body() confirmDto: ConfirmImportDto,
    @CurrentUser() user: User,
  ) {
    return this.importService.confirm(confirmDto, user.organizationId, user.id);
  }

  @Post(':id/attachments')
  @UseInterceptors(FastifyFilesInterceptor('files', 10, { limits: { fileSize: 10 * 1024 * 1024 } }))
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_EDIT)
  uploadAttachments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @UploadedFiles() files: Array<FastifyFile>,
  ) {
    const uploadPromises = files.map((file) =>

      this.journalEntriesService.addAttachment(id, file, user.organizationId, user.id),
    );
    return Promise.all(uploadPromises);
  }

  @Get(':id/attachments')
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  async getAttachments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    const entry = await this.journalEntriesService.findOne(
      id,
      user.organizationId,
    );
    return entry.attachments;
  }

  @Get('attachments/:attachmentId/download')
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  async downloadAttachment(
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: User,
  ): Promise<StreamableFile> {
    const { metadata, streamable } =
      await this.journalEntriesService.getAttachment(
        attachmentId,
        user.organizationId,
      );

    return new StreamableFile(streamable.stream, {
      type: streamable.mimeType,
      disposition: `attachment; filename="${metadata.fileName}"`,
      length: streamable.fileSize,
    });
  }

  @Delete('attachments/:attachmentId')
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_EDIT)
  async deleteAttachment(
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: User,
  ) {
    await this.journalEntriesService.deleteAttachment(
      attachmentId,
      user.organizationId,
    );
    return { message: 'Adjunto eliminado exitosamente.' };
  }
}