
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
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
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFilesInterceptor } from '../common/interceptors/fastify-files.interceptor';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import {
  UpdateJournalEntryDto,
  ReverseJournalEntryDto,
} from './dto/journal-entry-actions.dto';
import { JournalEntryImportService } from './journal-entry-import.service';
import { ConfirmImportDto, PreviewImportRequestDto } from './dto/journal-entry-import.dto';
import { TemporalValidityGuard } from '../financial-reporting/guards/temporal-validity.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';

@Controller('journal-entries')
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.create(
      createJournalEntryDto,
      user.organizationId,
      { actorUserId: user.id },
    );
  }

  @Get()
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.journalEntriesService.findAll(user.organizationId, query);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.journalEntriesService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_EDIT)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() updateDto: UpdateJournalEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.update(id, user.organizationId, updateDto, {
      actorUserId: user.id,
    });
  }

  @Post(':id/reverse')
  @Idempotent()
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  reverse(
    @Param('id', UuidParamPipe) id: string,
    @Body() reverseDto: ReverseJournalEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalEntriesService.reverse(id, user.organizationId, reverseDto, {
      actorUserId: user.id,
    });
  }
  
  @Post(':id/create-reversal')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  createReversal(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
      return this.journalEntriesService.createReversalEntry(id, user.organizationId, {
        actorUserId: user.id,
      });
  }

  /**
   * The column names of an uploaded file, so the caller can map them.
   *
   * `getFileHeaders` existed on the service and had no route, so the mapping screen had nothing to
   * offer the user and the client sent no mapping at all — which the preview route rejects, since
   * `columnMapping` is required. The import was unreachable from the product.
   */
  @Post('import/headers')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FastifyFileInterceptor('file'))
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  readImportHeaders(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(text\/csv|spreadsheetml\.sheet)/ }),
        ],
      }),
    )
    file: FastifyFile,
  ) {
    return this.importService.getFileHeaders(file);
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importService.preview(file, mapping, user.organizationId, user.id);
  }

  @Post('import/confirm')
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  confirmImport(
    @Body() confirmDto: ConfirmImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importService.confirm(confirmDto, user.organizationId, user.id);
  }

  @Post(':id/attachments')
  @UseInterceptors(FastifyFilesInterceptor('files', 10, { limits: { fileSize: 10 * 1024 * 1024 } }))
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_EDIT)
  uploadAttachments(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
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
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
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
    @Param('attachmentId', UuidParamPipe) attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
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
    @Param('attachmentId', UuidParamPipe) attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.journalEntriesService.deleteAttachment(
      attachmentId,
      user.organizationId,
    );
    return { messageKey: 'journal_entries.attachment_deleted' };
  }
}