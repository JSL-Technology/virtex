import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { RequiresPlatformPermission } from '../security/decorators/platform-permission.decorator';
import { PLATFORM_PERMISSIONS } from '../security/platform-permissions';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { UnprocessableEntityError } from '../i18n/localized.exception';
import { PriceIndexRangeQueryDto, RecordPriceIndexValuesDto } from './dto/price-index.dto';
import { PriceIndicesService } from './price-indices.service';

/**
 * General price indices for restating statements in constant currency (IAS 29; audit 2026-11-07,
 * FIN-AC-04).
 *
 * Reading is an accounting right: the indices are what a restatement multiplies by. A company
 * records a month for itself only where the published figure is missing, with a right of its own
 * so that typing the index and posting the restatement can be different people. Loading the
 * PUBLISHED figures changes every company's restatement, so it is a platform right, which no tenant
 * role can hold (`security/platform-permissions.ts`).
 */
@ApiTags('Price indices')
@ApiBearerAuth()
@Controller('price-indices')
export class PriceIndicesController {
  constructor(private readonly indices: PriceIndicesService) {}

  @Get()
  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @ApiOperation({ summary: 'Las series de índices que prescribe cada mercado.' })
  catalogue() {
    return this.indices.catalogue();
  }

  @Get(':code/values')
  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @ApiOperation({ summary: 'El valor de cada mes de una serie, con su revisión y su origen.' })
  async values(@Param('code') code: string, @Query() query: PriceIndexRangeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    if (query.from > query.to) {
      throw new UnprocessableEntityError('price_indices.range_inverted', { from: query.from, to: query.to });
    }
    return [...(await this.indices.resolve(user.organizationId, code, query.from, query.to)).values()];
  }

  @Get(':code/values/:period/history')
  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @ApiOperation({ summary: 'Todas las revisiones de un mes: las publicadas y las de la empresa.' })
  history(@Param('code') code: string, @Param('period') period: string, @CurrentUser() user: AuthenticatedUser) {
    return this.indices.history(user.organizationId, code, period);
  }

  @Post(':code/values')
  @HasPermission(PERMISSIONS.ACCOUNTING_MANAGE_PRICE_INDICES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registra meses de una serie para la empresa (cada cambio es una revisión nueva).' })
  record(@Param('code') code: string, @Body() dto: RecordPriceIndexValuesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.indices.recordForCompany(user.organizationId, code, dto.values, user.id);
  }

  @Post(':code/published-values')
  @HasPermission(PERMISSIONS.ACCOUNTING_MANAGE_PRICE_INDICES)
  // The shared figures every company restates with: a platform right on top of the tenant one.
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.REFERENCE_DATA_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Carga los valores publicados de una serie, para todas las empresas.' })
  recordPublished(@Param('code') code: string, @Body() dto: RecordPriceIndexValuesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.indices.recordPublished(code, dto.values, user.id);
  }
}
