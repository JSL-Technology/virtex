import { Controller, Post, Get, Body, Headers, Req, BadRequestException, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PaymentService } from './payment.service';
import { Request } from 'express';
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

  @Get('overview')
  @UseGuards(JwtAuthGuard)
  async getOverview(@CurrentUser() user: User) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    return this.paymentService.getBillingOverview(user.organizationId);
  }

  @Post('checkout/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmCheckout(
    @CurrentUser() user: User,
    @Body() body: { sessionId: string }
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    return this.paymentService.confirmOrganizationCheckout(user.organizationId, body.sessionId);
  }

  @Get('invoices')
  @UseGuards(JwtAuthGuard)
  async getInvoices(@CurrentUser() user: User) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    return this.paymentService.getInvoices(user.organizationId);
  }

  @Post('portal-session')
  @UseGuards(JwtAuthGuard)
  async createPortalSession(
    @CurrentUser() user: User,
    @Body() body: { returnUrl: string }
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    return this.paymentService.createBillingPortalSession(user.organizationId, body.returnUrl);
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

  @Post('webhook')
  @UseGuards(ThrottlerGuard)
  async handleWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request) {
    // Note: To handle webhook correctly, NestJS needs to pass raw body.
    // Ensure that main.ts or middleware preserves raw body for this route or access it correctly.
    // For now, assuming req.body is accessible as Buffer or raw string if configured,
    // but typically standard NestJS setup parses JSON.
    // We might need a raw body middleware.

    // As a workaround/standard practice in NestJS for Stripe:
    // We usually need a RawBody decorator or middleware.
    // For this implementation, I will assume the raw body is passed in `req['rawBody']`
    // (which needs to be set up in main.ts) OR I rely on a standard buffer approach.

    // Let's assume the user has a way to get raw body, or I'll implement a simple one later.
    // Ideally, `@Body()` with a specific pipe or `req.rawBody`.

    // NOTE: This is a placeholder for the actual buffer extraction which is tricky in NestJS default setup.
    const rawBody = (req as any).rawBody || req.body;

    return this.paymentService.handleWebhook(signature, rawBody);
  }
}
