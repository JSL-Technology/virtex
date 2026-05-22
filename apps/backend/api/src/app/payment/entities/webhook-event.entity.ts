import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('payment_webhook_events')
export class WebhookEvent {
  @PrimaryColumn()
  id: string; // Stripe Event ID

  @CreateDateColumn({ name: 'processed_at' })
  processedAt: Date;
}
