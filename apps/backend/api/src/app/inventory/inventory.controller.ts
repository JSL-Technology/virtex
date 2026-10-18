
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UploadedFile,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile, spooledUploadPath } from '../common/interfaces/fastify-file.interface';
import { BadRequestError } from '../i18n/localized.exception';
import { ProductImagesService } from './product-images.service';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { InventoryService } from './inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { clampLimit } from '../common/database/search-term';

@Controller('inventory')
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly images: ProductImagesService,
  ) {}

  /**
   * Store a product photo before the product exists; the create request claims it by id.
   *
   * The image was only ever previewed in the browser and its URL field left empty, so no product in
   * the catalogue had a photo. The bytes are decoded, stripped of metadata (GPS included) and
   * re-encoded before they are stored — see `ProductImagesService.storeImage`.
   */
  @Post('images')
  @HasPermission(PERMISSIONS.PRODUCTS_CREATE)
  @UseInterceptors(
    FastifyFileInterceptor('file', {
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.mimetype)) {
          return cb(new BadRequestError('inventory.product_image.not_an_image'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 12 * 1024 * 1024 },
    }),
  )
  async uploadImage(@UploadedFile() file: FastifyFile, @CurrentUser() user: AuthenticatedUser) {
    if (!file) throw new BadRequestError('users.file_required');
    const spooled = spooledUploadPath(file);
    try {
      const buffer = file.buffer ?? (spooled ? await fs.readFile(spooled) : null);
      if (!buffer?.length) throw new BadRequestError('users.file_required');
      const image = await this.images.storeImage(user.organizationId, user.id, {
        fileName: file.originalname ?? file.filename,
        mimeType: file.mimetype,
        buffer,
      });
      return { id: image.id, width: image.width, height: image.height };
    } finally {
      if (spooled) {
        await fs.unlink(spooled).catch((error) => this.logger.warn(`Failed to remove ${spooled}: ${error.message}`));
      }
    }
  }

  @Get(':id/images')
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  listImages(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.images.listForProduct(user.organizationId, id);
  }

  @Post()
  @HasPermission(PERMISSIONS.PRODUCTS_CREATE)
  create(@Body() createProductDto: CreateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.create(createProductDto, user.organizationId, user.id);
  }

  /**
   * El catálogo, acotado por `search` y limitado por `limit`.
   *
   * Ambos opcionales; omitirlos es lo que esta ruta ha hecho siempre. Existen para los selectores
   * de producto, que no tienen por qué descargarse el catálogo entero para enseñar diez filas.
   */
  @Get()
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryService.findAll(user.organizationId, {
      search,
      limit: clampLimit(limit),
    });
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.PRODUCTS_EDIT)
  update(@Param('id', UuidParamPipe) id: string, @Body() updateProductDto: UpdateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.update(id, updateProductDto, user.organizationId, user.id);
  }

  @Get(':id/dependents')
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  dependents(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.dependents(id, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.PRODUCTS_DELETE)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.remove(id, user.organizationId, user.id);
  }
}