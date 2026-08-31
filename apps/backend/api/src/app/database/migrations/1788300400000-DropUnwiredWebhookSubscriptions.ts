import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove the outbound-webhook table, because the feature it belonged to did not exist.
 *
 * `webhooks/` held an entity and a service and was registered in NO module — not in
 * `app.module.ts`, not anywhere — so `WebhookService` was never instantiated and its
 * `@OnEvent('**')` never ran. There was no controller either, so nothing could create a
 * subscription and the table has always been empty.
 *
 * It was not merely unused, it was a trap. `handleEvent` selected subscriptions by event alone:
 *
 *     this.subscriptionRepository.find({ where: { event } })
 *
 * while `WebhookSubscription` carries `organizationId`. Whoever eventually wired it up would have
 * shipped a cross-tenant leak — every subscriber receiving every tenant's payloads — with the
 * code reading as though it had been thought through. The typed `WebhookEvent` enum (three values)
 * against a wildcard listener would also have thrown on the first event outside it.
 *
 * Outbound webhooks are a real feature worth building: per-tenant subscriptions, secret rotation,
 * a delivery log, retries with backoff and replay. That is a product decision, not an audit fix,
 * and it should start from a design rather than from this.
 *
 * Safe to drop: the table is empty by construction, since nothing ever wrote it.
 */
export class DropUnwiredWebhookSubscriptions1788300400000 implements MigrationInterface {
  name = 'DropUnwiredWebhookSubscriptions1788300400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_subscriptions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "webhook_subscriptions_event_enum"`);
  }

  public async down(): Promise<void> {
    // Deliberately not recreated. Reintroducing the table without the feature would restore
    // exactly the half-wired state this removes.
  }
}
