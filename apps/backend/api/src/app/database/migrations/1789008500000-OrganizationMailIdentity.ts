import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The company's identity on the documents it e-mails (QA M-09, «Servidor de correo»).
 *
 * An invoice sent to a customer left with the platform's name and no Reply-To: the customer's
 * answer reached the software vendor. These columns carry the sender name, the reply address and
 * an optional blind copy; the message itself still leaves from the platform's authenticated domain.
 */
export class OrganizationMailIdentity1789008500000 implements MigrationInterface {
  name = 'OrganizationMailIdentity1789008500000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "mail_sender_name" character varying(100),
        ADD COLUMN IF NOT EXISTS "mail_reply_to" character varying(255),
        ADD COLUMN IF NOT EXISTS "mail_copy_to" character varying(255)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "organization_settings"
        DROP COLUMN IF EXISTS "mail_copy_to",
        DROP COLUMN IF EXISTS "mail_reply_to",
        DROP COLUMN IF EXISTS "mail_sender_name"
    `);
  }
}
