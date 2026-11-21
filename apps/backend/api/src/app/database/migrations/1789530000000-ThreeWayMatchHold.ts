import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three-way match hold (audit 2026-11-07, CMP-01): a supplier bill that charges for goods not
 * received, or at a price outside the order's tolerance, is held instead of booked. Bills posted
 * before this keep their status; nothing is re-evaluated retroactively.
 */
export class ThreeWayMatchHold1789530000000 implements MigrationInterface {
  name = 'ThreeWayMatchHold1789530000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TYPE "public"."vendor_bills_status_enum" ADD VALUE IF NOT EXISTS 'ON_HOLD' AFTER 'PENDING_APPROVAL'`);
    await q.query(`
      ALTER TABLE "vendor_bills"
        ADD COLUMN "match_exceptions" jsonb,
        ADD COLUMN "match_held_by" uuid,
        ADD COLUMN "match_released_by" uuid,
        ADD COLUMN "match_released_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "match_release_reason" text`);
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN "ap_match_price_tolerance_bps" integer NOT NULL DEFAULT 200`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE "vendor_bills" SET "status" = 'DRAFT' WHERE "status" = 'ON_HOLD'`);
    await q.query(`ALTER TABLE "organization_settings" DROP COLUMN "ap_match_price_tolerance_bps"`);
    await q.query(`
      ALTER TABLE "vendor_bills"
        DROP COLUMN "match_exceptions", DROP COLUMN "match_held_by", DROP COLUMN "match_released_by",
        DROP COLUMN "match_released_at", DROP COLUMN "match_release_reason"`);
    // PostgreSQL cannot drop an enum value; 'ON_HOLD' stays in the type, unused.
  }
}
