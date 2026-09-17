import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The identity-document catalogue: the table that replaces an enum with data.
 *
 * ## What was wrong
 *
 * `employees.identity_document_type` was a PostgreSQL `ENUM` of `CEDULA`, `PASSPORT`, `RNC` — two
 * Dominican documents on a table shared by nineteen markets. Registering the first Colombian
 * employee with a cédula de extranjería meant `ALTER TYPE … ADD VALUE`: a schema migration and a
 * deploy per country, in a type PostgreSQL will not let you shrink again.
 *
 * ## The natural key is the key
 *
 * `(country_code, code)` is unique and is what the business tables reference. A surrogate `id`
 * exists for consistency with the rest of the schema, but nothing joins on it: a foreign key to
 * the natural key keeps `employees.identity_document_type_code` readable in a query and makes it
 * impossible to point a row at a document its country does not issue.
 *
 * `country_code` is `char(2)` and carries `XX` for supranational documents — a passport belongs to
 * the traveller's state, not the employer's, and duplicating it nineteen times to say so would be
 * both wasteful and false.
 *
 * ## No enum here either
 *
 * `applies_to`, `requirement` and `canonical_form` are `varchar` with CHECK constraints rather
 * than PostgreSQL enums. A CHECK can be dropped and rewritten inside an ordinary transaction; an
 * enum cannot lose a value at all, which is the defect this migration exists to undo. Repeating it
 * one level down would be an odd way to fix it.
 *
 * The rows themselves are NOT inserted here. `IdentityDocumentService.seed()` writes them at boot
 * from `IDENTITY_DOCUMENT_TYPES`, which is the same arrangement `fiscal_regions` already uses, and
 * it keeps the declaration in one place that both the seeder and the tests read.
 */
export class IdentityDocumentCatalogue1789005000000 implements MigrationInterface {
  name = 'IdentityDocumentCatalogue1789005000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "identity_document_types" (
        "id"                uuid NOT NULL DEFAULT uuid_generate_v4(),
        "country_code"      character(2) NOT NULL,
        "code"              character varying(32) NOT NULL,
        "label_key"         character varying(128) NOT NULL,
        "label_verbatim"    character varying(64),
        "example"           character varying(64),
        "pattern"           character varying(256) NOT NULL,
        "checksum"          character varying(48),
        "canonical_form"    character varying(32) NOT NULL DEFAULT 'alphanumeric',
        "applies_to"        character varying(16) NOT NULL,
        "requirement"       character varying(16) NOT NULL,
        "used_for"          text array NOT NULL DEFAULT '{}',
        "is_default"        boolean NOT NULL DEFAULT false,
        "issuing_authority" character varying(64),
        "valid_from"        date,
        "valid_until"       date,
        "sort_order"        smallint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_identity_document_types" PRIMARY KEY ("id"),
        CONSTRAINT "CK_identity_document_types_applies_to"
          CHECK ("applies_to" IN ('individual', 'company', 'both')),
        CONSTRAINT "CK_identity_document_types_requirement"
          CHECK ("requirement" IN ('required', 'optional')),
        CONSTRAINT "CK_identity_document_types_canonical_form"
          CHECK ("canonical_form" IN ('digits', 'alphanumeric', 'segmented'))
      )
    `);

    // The natural key, as a unique INDEX rather than a unique CONSTRAINT.
    //
    // PostgreSQL accepts either as the target of a foreign key, and an index is what TypeORM
    // models — declaring it as a constraint left the schema-drift check looking at an object the
    // entities did not describe, which it correctly reported as drift.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_identity_document_types_country_code"
        ON "identity_document_types" ("country_code", "code")
    `);

    // Every lookup is "what can this country offer?", so the index leads with the country.
    await queryRunner.query(`
      CREATE INDEX "IDX_identity_document_types_country"
        ON "identity_document_types" ("country_code", "sort_order")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "identity_document_types"`);
  }
}
