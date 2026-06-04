import { Injectable, Logger, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { SaasService } from '../saas/saas.service';
import { SAAS_CONFIG } from '../saas/saas.config';
import { WebhookEvent } from './entities/webhook-event.entity';
import { PaymentGateway } from './interfaces/payment-gateway.interface';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private configService: ConfigService,
    @InjectRepository(Organization)
    private organizationRepository: Repository<Organization>,
    @InjectRepository(WebhookEvent)
    private webhookEventRepository: Repository<WebhookEvent>,
    
    private saasService: SaasService,
    
    private dataSource: DataSource,
    @Inject('PAYMENT_GATEWAY') private paymentGateway: PaymentGateway
  ) {}

  async createCheckoutSession(organizationId: string, userEmail: string, priceId: string, successUrl: string, cancelUrl: string) {
    return this.paymentGateway.createCheckoutSession({
        organizationId,
        userEmail,
        priceId,
        successUrl,
        cancelUrl
    });
  }

  async createRegistrationCheckoutSession(dto: Parameters<PaymentGateway['createRegistrationCheckoutSession']>[0]) {
    return this.paymentGateway.createRegistrationCheckoutSession(dto);
  }

  async getCheckoutSession(sessionId: string) {
    return this.paymentGateway.getCheckoutSession(sessionId);
  }

  async handleWebhook(signature: string, payload: Buffer) {
    // Ahora está completamente abstraído. La implementación del Gateway maneja la lógica específica.
    return this.paymentGateway.handleWebhook(payload, signature);
  }

  async getBillingOverview(organizationId: string) {
    return this.paymentGateway.getBillingOverview(organizationId);
  }

  async confirmOrganizationCheckout(organizationId: string, sessionId: string) {
    return this.paymentGateway.confirmOrganizationCheckout(organizationId, sessionId);
  }

  async getInvoices(organizationId: string, limit?: number) {
    return this.paymentGateway.getInvoices(organizationId, limit);
  }

  async createBillingPortalSession(organizationId: string, returnUrl: string) {
    return this.paymentGateway.createBillingPortalSession(organizationId, returnUrl);
  }
}