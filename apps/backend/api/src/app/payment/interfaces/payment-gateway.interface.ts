
export interface CreateCheckoutSessionDto {
  organizationId: string;
  userEmail: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, any>;
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface WebhookResult {
    processed: boolean;
    eventId: string;
    type: string;
}

export interface PaymentGateway {
  createCheckoutSession(dto: CreateCheckoutSessionDto): Promise<CheckoutSessionResult>;
  handleWebhook(payload: Buffer, signature: string): Promise<WebhookResult>;
}
