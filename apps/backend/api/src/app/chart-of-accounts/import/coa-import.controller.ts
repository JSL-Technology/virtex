
import { Controller, Post, UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator, FileTypeValidator, Body, UseGuards, Get } from '@nestjs/common';
import { FastifyFileInterceptor } from '../../common/interceptors/fastify-file.interceptor';
import { FastifyFile } from '../../common/interfaces/fastify-file.interface';
import { CoaImportService } from './coa-import.service';

import { ConfirmCoaImportDto, PreviewCoaImportDto } from './dto/coa-import.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../../shared/permissions';

@Controller('chart-of-accounts/import')
@UseGuards(JwtAuthGuard)
export class CoaImportController {
  constructor(private readonly coaImportService: CoaImportService) {}

  @HasPermission(PERMISSIONS.CHART_OF_ACCOUNTS_IMPORT)
  @Get('template')
  getTemplate() {
    return this.coaImportService.getImportTemplate();
  }
  
  @HasPermission(PERMISSIONS.CHART_OF_ACCOUNTS_IMPORT)
  
  @Post('preview')
  @UseInterceptors(FastifyFileInterceptor('file'))
  previewImport(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(text\/csv|spreadsheetml\.sheet)/ }),
        ],
      }),
    ) file: FastifyFile,
    @Body() dto: PreviewCoaImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.coaImportService.preview(file, dto.columnMapping, user.organizationId, user.id);
  }

  @HasPermission(PERMISSIONS.CHART_OF_ACCOUNTS_IMPORT)
  @Post('confirm')
  confirmImport(
    @Body() dto: ConfirmCoaImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.coaImportService.confirm(dto.batchId, user.organizationId, user.id);
  }
}

