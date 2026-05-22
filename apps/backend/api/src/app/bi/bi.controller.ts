import { Controller, Get, Query, Inject } from '@nestjs/common';
import { BiService } from './bi.service';
import { SalesQueryDto } from './dto/sales-query.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as crypto from 'crypto';

@Controller('bi')
export class BiController {
  constructor(
    private readonly biService: BiService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  @Get('sales')
  async getSalesData(@Query() query: SalesQueryDto) {

    const cacheKey = `sales_query_${this.createHash(JSON.stringify(query))}`;


    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      console.log('Servido desde la caché:', cacheKey);
      return cachedData;
    }


    const data = await this.biService.getSalesData({
      dimensions: query.dimensions,
      measures: query.measures,
      filters: query.filters,
    });


    await this.cacheManager.set(cacheKey, data, 300);
    console.log('Guardado en caché:', cacheKey);

    return data;
  }

  private createHash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
