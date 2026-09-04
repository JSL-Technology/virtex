import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { ExchangeRatesService } from './exchange-rates.service';
import {
  BackfillRatesDto,
  RecordRateDto,
  RateLookupDto,
} from './dto/exchange-rate.dto';

/**
 * Exchange rates.
 *
 * ## Why this route needed a permission more than most
 *
 * `exchange_rates` is deliberately **not** tenant-scoped: what a currency was worth on a given day
 * is a fact about the market, not about the customer. That makes it the one finance table where a
 * write by one tenant changes every other tenant's arithmetic — and `POST /exchange-rates/update`
 * carried `JwtAuthGuard` and nothing else. Any authenticated user of any organization could rewrite
 * the rates the whole platform values its ledgers with, and burn the upstream provider's quota
 * doing it.
 *
 * It is also rate-limited, separately from the global throttle: the refresh calls an external
 * provider that bills per request, and "authorized" is not the same as "unbounded".
 */
@ApiTags('Exchange rates')
@ApiBearerAuth()
@Controller('exchange-rates')
@UseGuards(JwtAuthGuard)
export class ExchangeRatesController {
  constructor(private readonly exchangeRatesService: ExchangeRatesService) {}

  @Post('update')
  @HasPermission(PERMISSIONS.EXCHANGE_RATES_MANAGE)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresca las tasas del día desde las fuentes configuradas.' })
  updateRates() {
    return this.exchangeRatesService.updateRates();
  }

  /**
   * Fill in a range of past days.
   *
   * The scheduled refresh only ever asked for *today*, so a tenant that started using the product
   * on Monday had no rate for any document dated before Monday — and a back-dated invoice in a
   * foreign currency simply could not be recorded.
   */
  @Post('backfill')
  @HasPermission(PERMISSIONS.EXCHANGE_RATES_MANAGE)
  @Throttle({ default: { limit: 2, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rellena las tasas de un rango de fechas pasadas.' })
  backfill(@Body() dto: BackfillRatesDto) {
    return this.exchangeRatesService.backfill(dto);
  }

  /**
   * Record a rate by hand.
   *
   * Necessary, not a convenience: several authorities in the region publish the rate a taxpayer
   * must use through channels no API covers, and a rate that cannot be entered is a document that
   * cannot be booked.
   */
  @Post()
  @HasPermission(PERMISSIONS.EXCHANGE_RATES_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registra o corrige la tasa de un par para una fecha.' })
  record(@Body() dto: RecordRateDto, @CurrentUser('id') actorUserId: string) {
    return this.exchangeRatesService.record(dto, actorUserId);
  }

  @Get()
  @HasPermission(PERMISSIONS.CURRENCIES_VIEW)
  @ApiOperation({ summary: 'Tasa aplicable a un par en una fecha, con su origen.' })
  lookup(@Query() query: RateLookupDto) {
    return this.exchangeRatesService.explain(
      query.from,
      query.to,
      query.date,
      query.rateType,
    );
  }
}
