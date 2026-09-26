import { Controller, Get, Query, Inject } from '@nestjs/common';
import { BiService } from './bi.service';
import { SalesQueryDto } from './dto/sales-query.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';

@Controller('bi')
export class BiController {
  constructor(
    private readonly biService: BiService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * El cubo de ventas de la empresa activa.
   *
   * ## La clave de caché lleva la empresa, y antes no
   *
   * Era `sales_query_${hash(query)}`: el hash de los PARÁMETROS, y nada más. Como la consulta no
   * llevaba inquilino, dos empresas que pidieran el mismo informe —que es lo normal: «ventas por
   * mes de este año»— generaban la misma clave, y la segunda recibía de Redis las ventas de la
   * primera. Un fallo de aislamiento servido desde la caché compartida, sin llegar a tocar la base
   * de datos.
   *
   * Arreglar la consulta sin arreglar la clave habría dejado el agujero exactamente donde estaba
   * durante los cinco minutos de TTL.
   */
  @Get('sales')
  @HasPermission(PERMISSIONS.BI_VIEW)
  async getSalesData(@Query() query: SalesQueryDto, @CurrentUser() user: AuthenticatedUser) {

    const cacheKey = `sales_query_${user.organizationId}_${this.createHash(JSON.stringify(query))}`;

    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const data = await this.biService.getSalesData({
      dimensions: query.dimensions,
      measures: query.measures,
      filters: query.filters,
      // Del principal, nunca del cliente: es lo que decide qué filas se leen.
      organizationId: user.organizationId,
    });

    await this.cacheManager.set(cacheKey, data, 300);

    return data;
  }

  private createHash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
