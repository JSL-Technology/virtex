import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile, toUploadableFile } from '../common/interfaces/fastify-file.interface';
import { BadRequestError } from '../i18n/localized.exception';
import { DocumentsService } from './documents.service';
import { DocumentTemplateType } from './entities/document-node.entity';
import {
  CreateFolderDto,
  ListDocumentsDto,
  MoveDocumentDto,
  RenameDocumentDto,
  UpdateDocumentDto,
} from './dto/documents.dto';

/** 50 MB. Beyond this a document repository is a file-sync product, which this is not. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * The tenant's document repository.
 *
 * There was no controller: the repository screen listed six files invented in the browser and its
 * upload button uploaded nothing. See {@link DocumentsService} for what the tree guarantees.
 */
@ApiTags('Documents')
@ApiBearerAuth()
@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @HasPermission(PERMISSIONS.DOCUMENTS_VIEW)
  @ApiOperation({ summary: 'Lista el contenido de una carpeta, o busca en todo el árbol.' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDocumentsDto) {
    return this.documents.list(user.organizationId, query);
  }

  @Get(':id/breadcrumb')
  @HasPermission(PERMISSIONS.DOCUMENTS_VIEW)
  @ApiOperation({ summary: 'La cadena de carpetas desde la raíz hasta este nodo.' })
  breadcrumb(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.breadcrumb(id, user.organizationId);
  }

  @Get(':id/download')
  @HasPermission(PERMISSIONS.DOCUMENTS_VIEW)
  @ApiOperation({ summary: 'Descarga el archivo, en streaming.' })
  async download(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { node, file } = await this.documents.stream(id, user.organizationId);
    // Quoted and escaped: a filename with a quote in it would otherwise truncate the header and
    // let the rest of the name be read as further parameters.
    const safeName = node.name.replace(/["\\]/g, '_');
    reply
      // The type recorded at upload wins: storage infers it from the object and a local filesystem
      // has nothing to infer it from, so a text file came back as `application/octet-stream`.
      .header('Content-Type', node.mimeType || file.mimeType || 'application/octet-stream')
      .header('Content-Length', String(file.fileSize))
      .header('Content-Disposition', `attachment; filename="${safeName}"`)
      .send(file.stream);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.DOCUMENTS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.findOne(id, user.organizationId);
  }

  @Post('folders')
  @HasPermission(PERMISSIONS.DOCUMENTS_MANAGE)
  @ApiOperation({ summary: 'Crea una carpeta.' })
  createFolder(@Body() dto: CreateFolderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.createFolder(dto, user.organizationId, user.id);
  }

  @Post('upload')
  @HasPermission(PERMISSIONS.DOCUMENTS_MANAGE)
  @UseGuards(CsrfGuard)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sube un archivo a una carpeta.' })
  @UseInterceptors(FastifyFileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @UploadedFile() file: FastifyFile,
    @Body() body: { parentId?: string; templateType?: DocumentTemplateType; description?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestError('documents.file_required');
    return this.documents.upload(
      toUploadableFile(file),
      {
        parentId: body?.parentId || undefined,
        templateType: body?.templateType,
        description: body?.description,
      },
      user.organizationId,
      user.id,
    );
  }

  @Patch(':id/rename')
  @HasPermission(PERMISSIONS.DOCUMENTS_MANAGE)
  rename(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: RenameDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.rename(id, dto, user.organizationId);
  }

  @Patch(':id/move')
  @HasPermission(PERMISSIONS.DOCUMENTS_MANAGE)
  move(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: MoveDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.move(id, dto, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.DOCUMENTS_MANAGE)
  @ApiOperation({ summary: 'Marca un archivo como plantilla, o cambia su descripción.' })
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.DOCUMENTS_MANAGE)
  @ApiOperation({ summary: 'Borra un nodo y todo lo que cuelga de él, objetos incluidos.' })
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.remove(id, user.organizationId);
  }
}
