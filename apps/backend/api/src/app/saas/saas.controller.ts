import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { PlanResponseDto } from './dto/plan-response.dto';
import { SaasService } from './saas.service';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { Public } from '../auth/decorators/public.decorator';
import type { HttpRequest as Request } from '../common/http/http.types';
import { AllowInactiveSubscription } from './decorators/allow-inactive-subscription.decorator';

/**
 * Plans and usage remain visible to a suspended tenant: they are what explains the suspension and
 * what the customer needs to see in order to resolve it.
 */
@AllowInactiveSubscription()
@Controller('saas')
export class SaasController {
  constructor(private readonly saasService: SaasService) {}

  // Public: the registration page (unauthenticated) must list plans. Without
  // @Public() the global JwtAuthGuard returns 401, which the web client's auth
  // interceptor treats as an expired session — triggering a refresh + forced
  // logout that bounces the visitor to /auth/login.
  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'Plans available for signup' })
  async getPlans(@Query('country') country?: string): Promise<PlanResponseDto[]> {
    // The country selects the currency the plan is quoted in. Omitted, the plan comes back in the
    // platform's base currency, which is what an anonymous visitor with no country yet sees.
    const plans = await this.saasService.getPlansForCountry(country);
    return plans.map((plan) => plainToInstance(PlanResponseDto, plan, { excludeExtraneousValues: true }));
  }

  @Get('usage')
  @UseGuards(AuthGuard('jwt'))
  async getUsage(@Req() req: Request) {
    const user = (req as unknown as { user: AuthenticatedUser }).user;
    if (!user.organizationId) {
        return [];
    }
    return this.saasService.getUsage(user.organizationId);
  }
}
