import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bring the migrated schema back in line with the entity model.
 *
 * `npm run check:schema-drift` provisions a database purely from the migrations and then asks
 * TypeORM to generate one against it: a repository whose migrations and entities agree produces
 * nothing. The remaining disagreement was a real one, not a modelling artefact.
 *
 * `approval_policy_steps.policyId` declares `onDelete: 'CASCADE'` on the entity, and the foreign
 * key in the database had no action at all. Deleting a policy therefore failed with a foreign-key
 * violation rather than taking its steps with it — and a policy that cannot be deleted while its
 * steps exist, and whose steps can only be deleted through the policy, cannot be deleted at all.
 *
 * Everything else the check was reporting — the sign constraints on lines and valuations, the
 * exchange-rate constraint, the two partial indexes, the excise foreign key, the `fx_rate_tolerance`
 * default — existed in the database and was simply absent from the entity metadata. Those are
 * fixed on the entities, where they belong, rather than by dropping the objects.
 */
export class SchemaAlignment1789000400000 implements MigrationInterface {
  name = 'SchemaAlignment1789000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "approval_policy_steps"
        DROP CONSTRAINT IF EXISTS "FK_e89a7e5c28e30aea444f3ad2c1b"
    `);
    await queryRunner.query(`
      ALTER TABLE "approval_policy_steps"
        ADD CONSTRAINT "FK_e89a7e5c28e30aea444f3ad2c1b"
        FOREIGN KEY ("policyId") REFERENCES "approval_policies"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "approval_policy_steps"
        DROP CONSTRAINT IF EXISTS "FK_e89a7e5c28e30aea444f3ad2c1b"
    `);
    await queryRunner.query(`
      ALTER TABLE "approval_policy_steps"
        ADD CONSTRAINT "FK_e89a7e5c28e30aea444f3ad2c1b"
        FOREIGN KEY ("policyId") REFERENCES "approval_policies"("id")
    `);
  }
}
