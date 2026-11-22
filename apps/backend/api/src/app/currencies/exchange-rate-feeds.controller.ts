import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { RequiresPlatformPermission } from '../security/decorators/platform-permission.decorator';
import { PLATFORM_PERMISSIONS } from '../security/platform-permissions';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { OfficialRateFeedRunsQueryDto, RunOfficialRateFeedDto, SetOfficialRateFeedStatusDto } from './dto/official-rate-feed.dto';
import { OfficialRatesService } from './official-rates.service';

/**
 * The official-rate feeds (FINB-03), for the platform's operators.
 *
 * A feed writes the official rate every company of its market converts with, so operating it is a
 * platform right on top of the tenant one — which no tenant role can hold. Activating a feed, which
 * is what makes its figures official, takes the reference-data right; reading one and looking at
 * its log take the right to refresh the shared rates.
 */
@ApiTags('Official exchange-rate feeds')
@ApiBearerAuth()
@Controller('exchange-rate-feeds')
export class ExchangeRateFeedsController {
  constructor(private readonly official: OfficialRatesService) {}

  @Get()
  @HasPermission(PERMISSIONS.EXCHANGE_RATES_MANAGE)
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.EXCHANGE_RATES_REFRESH)
  @ApiOperation({ summary: 'Cada fuente de tasa oficial: qué lee, en qué estado está y su última lectura.' })
  list() {
    return this.official.feeds();
  }

  @Get(':code')
  @HasPermission(PERMISSIONS.EXCHANGE_RATES_MANAGE)
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.EXCHANGE_RATES_REFRESH)
  @ApiOperation({ summary: 'Una fuente de tasa oficial.' })
  feed(@Param('code') code: string) {
    return this.official.feed(code);
  }

  @Get(':code/runs')
  @HasPermission(PERMISSIONS.EXCHANGE_RATES_MANAGE)
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.EXCHANGE_RATES_REFRESH)
  @ApiOperation({ summary: 'Las lecturas de una fuente, de la más reciente a la más antigua.' })
  runs(@Param('code') code: string, @Query() query: OfficialRateFeedRunsQueryDto) {
    return this.official.history(code, query.limit);
  }

  @Post(':code/runs')
  @HasPermission(PERMISSIONS.EXCHANGE_RATES_MANAGE)
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.EXCHANGE_RATES_REFRESH)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lee la fuente ahora: compara en observación, escribe si está activa.' })
  run(@Param('code') code: string, @Body() dto: RunOfficialRateFeedDto, @CurrentUser() user: AuthenticatedUser) {
    return this.official.run(code, { trigger: 'OPERATOR', actorUserId: user.id, ...dto });
  }

  @Put(':code/status')
  @HasPermission(PERMISSIONS.EXCHANGE_RATES_MANAGE)
  // Activating a feed is what makes its figures every company's official rate.
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.REFERENCE_DATA_MANAGE)
  @ApiOperation({ summary: 'Activa la fuente, la devuelve a observación o la desactiva.' })
  setStatus(@Param('code') code: string, @Body() dto: SetOfficialRateFeedStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.official.setStatus(code, dto.status, user.id);
  }
}
