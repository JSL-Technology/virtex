import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export enum WebhookEvent {
  INVOICE_CREATED = 'invoice.created',
  INVOICE_PAID = 'invoice.paid',
  CUSTOMER_CREATED = 'customer.created',
}

@Entity({ name: 'webhook_subscriptions' })
export class WebhookSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column()
  targetUrl: string;

  @Column({ type: 'enum', enum: WebhookEvent })
  event: WebhookEvent;

  @Column()
  secret: string;
}
