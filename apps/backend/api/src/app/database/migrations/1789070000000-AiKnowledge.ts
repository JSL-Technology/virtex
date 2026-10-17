import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The in-app help the assistant answers "how do I…?" from.
 *
 * Product documentation, the same for every tenant: a GLOBAL table, with no tenant column and no
 * row policy (see `tenant-table-classification.ts`). It is written by the API at start-up from the
 * articles shipped with it (`ai/help/articles`), never by a tenant, and holds nothing about any
 * company. Searched with Postgres full-text search over the Spanish configuration.
 */
export class AiKnowledge1789070000000 implements MigrationInterface {
  name = 'AiKnowledge1789070000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_knowledge_chunks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source" varchar(200) NOT NULL,
        "ordinal" integer NOT NULL,
        "title" varchar(300) NOT NULL,
        "heading" varchar(300) NOT NULL DEFAULT '',
        "route" varchar(300) NULL,
        "content" text NOT NULL,
        "content_hash" char(64) NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_knowledge_chunks" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_knowledge_chunks_source_ordinal" UNIQUE ("source", "ordinal")
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_knowledge_chunks_search"
        ON "ai_knowledge_chunks"
        USING gin (to_tsvector('spanish', "title" || ' ' || "heading" || ' ' || "content"))
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_knowledge_chunks" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ai_knowledge_chunks"`);
  }
}
