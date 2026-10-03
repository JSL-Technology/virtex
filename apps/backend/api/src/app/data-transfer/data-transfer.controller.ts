import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { readFile } from 'fs/promises';
import type { HttpResponse as Response } from '../common/http/http.types';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile, spooledUploadPath } from '../common/interfaces/fastify-file.interface';
import { BadRequestError } from '../i18n/localized.exception';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { DataTransferFile, DataTransferService } from './data-transfer.service';
import { ExportRequestDto, ImportQueryDto, RunsQueryDto, TemplateParamsDto } from './dto/data-transfer.dto';
import { DataTransferKind } from './entities/data-transfer-run.entity';

/**
 * Every route is reachable by any signed-in user and decides per DATASET: exporting customers needs
 * `customers:view`, importing them `customers:create` — the same permissions as reading or
 * creating one by hand. A single route-level permission cannot express that, so the check lives in
 * `DataTransferService`, against the permission each domain registered.
 */
@Controller('data-transfer')
export class DataTransferController {
  constructor(private readonly transfer: DataTransferService) {}

  @Get('datasets')
  @AuthenticatedOnly(
    'Lista solo los conjuntos que el usuario puede ver, filtrados en DataTransferService por el permiso de vista que cada dominio declaró; un permiso de ruta único no puede expresarlo.',
  )
  datasets(@CurrentUser() user: AuthenticatedUser) {
    return this.transfer.datasets(user);
  }

  @Get('runs')
  @AuthenticatedOnly(
    'Devuelve el historial de la empresa activa limitado a los conjuntos que el usuario puede ver; el filtro por permiso de cada conjunto ocurre en DataTransferService.',
  )
  runs(@CurrentUser() user: AuthenticatedUser, @Query() query: RunsQueryDto) {
    return this.transfer.recentRuns(user, query.kind as DataTransferKind | undefined);
  }

  @Get('datasets/:dataset/template')
  @AuthenticatedOnly(
    'La plantilla solo se entrega a quien puede crear esos registros a mano: DataTransferService exige el permiso de creación que el dominio registró para ese conjunto.',
  )
  template(@Param() params: TemplateParamsDto, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    this.send(res, this.transfer.template(user, params.dataset));
  }

  /** Generating a file reads every row of a dataset: limited so it cannot be used as a scraper. */
  @Post('exports')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @AuthenticatedOnly(
    'Exportar exige el mismo permiso que ver esos registros, distinto por conjunto (clientes, productos, facturas…); DataTransferService lo comprueba contra lo que registró cada dominio.',
  )
  async export(@Body() dto: ExportRequestDto, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    this.send(res, await this.transfer.export(user, dto.dataset, dto.format));
  }

  @Post('imports')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @AuthenticatedOnly(
    'Importar exige el mismo permiso que crear esos registros a mano, distinto por conjunto; DataTransferService lo comprueba antes de leer el archivo y cada fila pasa por el servicio del dominio.',
  )
  @UseInterceptors(FastifyFileInterceptor('file'))
  async import(
    @Query() query: ImportQueryDto,
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 })] }))
    file: FastifyFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!/\.(csv|xlsx)$/i.test(file.originalname ?? '')) {
      throw new BadRequestError('data_transfer.unsupported_file_type');
    }
    const spooled = spooledUploadPath(file);
    const buffer = file.buffer ?? (spooled ? await readFile(spooled) : undefined);
    if (!buffer?.length) throw new BadRequestError('data_transfer.file_has_no_rows');
    return this.transfer.import(
      user,
      query.dataset,
      { originalname: file.originalname, mimetype: file.mimetype ?? '', buffer },
      query.mode ?? 'commit',
    );
  }

  private send(res: Response, file: DataTransferFile): void {
    res
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .header('Content-Length', String(file.body.length))
      .header('Cache-Control', 'no-store')
      .send(file.body);
  }
}
