import { Controller, Post, Get, Body, Headers, RawBody, BadRequestException, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { SaasService } from '../saas/saas.service';

@Controller('payment')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly saasService: SaasService
  ) {}

  @Post('checkout-session')
  @UseGuards(JwtAuthGuard)
  async createCheckoutSession(
    @CurrentUser() user: User,
    @Body() body: { priceId: string; successUrl: string; cancelUrl: string }
  ) {
    if (!user.organizationId) {
        throw new BadRequestException('User does not belong to an organization');
    }
    return this.paymentService.createCheckoutSession(
      user.organizationId,
      user.email,
      body.priceId,
      body.successUrl,
      body.cancelUrl
    );
  }

  @Get('config')
  async getConfig() {
    const plans = await this.saasService.getPlans();
    // Transform to expected format if needed, or better, return the plans directly
    // Returning legacy format for backward compatibility + new format
    return {
      prices: {
        starter: plans.find(p => p.slug === 'starter')?.monthlyPriceId,
        pro: plans.find(p => p.slug === 'pro')?.monthlyPriceId,
        enterprise: plans.find(p => p.slug === 'enterprise')?.monthlyPriceId,
      },
      plans: plans
    };
  }

  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  async getSubscription(@CurrentUser() user: User) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    return this.paymentService.getSubscription(user.organizationId);
  }

  @Post('webhook')
  @UseGuards(ThrottlerGuard)
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @RawBody() rawBody: Buffer,
  ) {
    return this.paymentService.handleWebhook(signature, rawBody);
  }
}
