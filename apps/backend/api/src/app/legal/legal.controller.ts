import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../security/decorators/public.decorator';
import { LegalService } from './legal.service';
import { MarketWaitlistDto } from './dto/market-waitlist.dto';

/**
 * Public, unauthenticated: the legal pages are read before anybody has an account, and the
 * waitlist is for people who cannot have one yet.
 */
@ApiTags('Legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  /** The editions in force and the support address, for the Terms, Privacy, Security and Contact pages. */
  @Get('info')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Legal document editions in force and the public support address' })
  info() {
    return this.legal.info();
  }

  /** "We are not in your country yet — notify me." */
  @Post('market-waitlist')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ask to be told when the product opens in a country' })
  async joinWaitlist(@Body() dto: MarketWaitlistDto, @Ip() ip: string) {
    await this.legal.joinWaitlist(dto, ip ?? null);
    return { messageKey: 'legal.waitlist.joined' };
  }
}
