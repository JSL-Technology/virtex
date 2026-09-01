import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notifications stop being a rendered Spanish sentence and become a key plus its values.
 *
 * A notification was stored as `title` and `body` text, written in Spanish at the point the event
 * fired ("No pudimos cobrar tu suscripción"), so every member of every tenant read it in Spanish
 * whatever language they had chosen — and a dunning notice is exactly the message a customer must
 * not misread.
 *
 * `title_key`, `body_key` and `params` carry what the message MEANS; `title` and `body` stay as
 * the rendering made at the moment it was created. Two reasons for keeping both:
 *
 *  - **Push notifications leave the system immediately.** A web-push payload is delivered by the
 *    browser's push service and cannot be re-rendered later, so it needs text at write time.
 *  - **Rows that predate this migration have no keys**, and their text is all there is. Reading
 *    falls back to it rather than showing a dotted identifier for a year of history.
 *
 * Nullable and additive: no backfill, and an old row keeps working exactly as it did.
 *
 * `timezone` on organizations is set in the same migration because it is the other half of the
 * same problem — the column existed, defaulted to `'UTC'` for every tenant, and was never
 * populated from the country, so an accounting date could not be rendered correctly for anybody.
 */
export class LocalizedNotifications1788500000000 implements MigrationInterface {
  name = 'LocalizedNotifications1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notification"
        ADD COLUMN IF NOT EXISTS "title_key" character varying(160),
        ADD COLUMN IF NOT EXISTS "body_key"  character varying(160),
        ADD COLUMN IF NOT EXISTS "params"    jsonb
    `);

    // The existing text stays authoritative for these rows; the keys are simply absent.
    await queryRunner.query(`
      COMMENT ON COLUMN "notification"."title" IS
        'Rendering made when the notification was created. Read only when title_key is null.'
    `);

    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN IF NOT EXISTS "books_language" character varying(5)
    `);

    /*
     * The language a customer's documents are written in.
     *
     * An invoice follows its RECIPIENT, not its issuer and not whoever pressed the button: a
     * Dominican company invoicing a Brazilian customer sends Portuguese. Nullable, because most
     * customers never state a preference and the country is then the better guess.
     */
    await queryRunner.query(`
      ALTER TABLE "customers"
        ADD COLUMN IF NOT EXISTS "preferred_language" character varying(5)
    `);

    /*
     * Backfill the tenant's statutory language and timezone from its country.
     *
     * `timezone` has always defaulted to 'UTC' and was never written, so every tenant claimed to
     * be in UTC — which is nobody's actual timezone in these markets and is off by four to six
     * hours from all of them. The values below are each country's civil time; the ones with a
     * single nationwide zone are exact, and the two that do not (Mexico, Brazil) get the zone of
     * the commercial centre, which is the right default for a tenant that has not said otherwise.
     */
    await queryRunner.query(`
      UPDATE "organizations" SET
        "books_language" = COALESCE("books_language", CASE UPPER(COALESCE("country", 'DO'))
          WHEN 'US' THEN 'en'
          WHEN 'BR' THEN 'pt'
          ELSE 'es' END),
        "timezone" = CASE
          WHEN "timezone" IS NULL OR "timezone" = 'UTC' THEN CASE UPPER(COALESCE("country", 'DO'))
            WHEN 'DO' THEN 'America/Santo_Domingo'
            WHEN 'US' THEN 'America/New_York'
            WHEN 'MX' THEN 'America/Mexico_City'
            WHEN 'CO' THEN 'America/Bogota'
            WHEN 'CL' THEN 'America/Santiago'
            WHEN 'PE' THEN 'America/Lima'
            WHEN 'AR' THEN 'America/Argentina/Buenos_Aires'
            WHEN 'BR' THEN 'America/Sao_Paulo'
            WHEN 'EC' THEN 'America/Guayaquil'
            WHEN 'UY' THEN 'America/Montevideo'
            WHEN 'PY' THEN 'America/Asuncion'
            WHEN 'BO' THEN 'America/La_Paz'
            WHEN 'VE' THEN 'America/Caracas'
            WHEN 'PA' THEN 'America/Panama'
            WHEN 'CR' THEN 'America/Costa_Rica'
            WHEN 'GT' THEN 'America/Guatemala'
            WHEN 'SV' THEN 'America/El_Salvador'
            WHEN 'HN' THEN 'America/Tegucigalpa'
            WHEN 'NI' THEN 'America/Managua'
            ELSE 'UTC' END
          ELSE "timezone"
        END
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers" DROP COLUMN IF EXISTS "preferred_language"
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations" DROP COLUMN IF EXISTS "books_language"
    `);
    await queryRunner.query(`
      ALTER TABLE "notification"
        DROP COLUMN IF EXISTS "params",
        DROP COLUMN IF EXISTS "body_key",
        DROP COLUMN IF EXISTS "title_key"
    `);
    // `timezone` is deliberately NOT reverted: putting every tenant back on UTC would be a data
    // loss disguised as a rollback.
  }
}
