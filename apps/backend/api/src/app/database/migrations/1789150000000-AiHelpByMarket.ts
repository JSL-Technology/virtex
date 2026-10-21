import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * In-app help by language and market (`ai_knowledge_chunks`).
 *
 * The articles were all Spanish and all searched with the Spanish dictionary, and one of them (the
 * NCF rules) is Dominican law: an English-speaking company in Texas was told to search in Spanish
 * and could be answered with the DGII's rules. Each section now records the article's `language`
 * and the `countries` it applies to (empty = every market), and each language is searched with its
 * own text-search dictionary, through an index of its own.
 */
export class AiHelpByMarket1789150000000 implements MigrationInterface {
  name = 'AiHelpByMarket1789150000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ai_knowledge_chunks" ADD COLUMN IF NOT EXISTS "language" varchar(8) NOT NULL DEFAULT 'es'`);
    await q.query(`ALTER TABLE "ai_knowledge_chunks" ADD COLUMN IF NOT EXISTS "countries" jsonb NOT NULL DEFAULT '[]'`);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_knowledge_chunks_search_en"
        ON "ai_knowledge_chunks"
        USING gin (to_tsvector('english', "title" || ' ' || "heading" || ' ' || "content"))
        WHERE "language" = 'en'
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_knowledge_chunks_search_pt"
        ON "ai_knowledge_chunks"
        USING gin (to_tsvector('portuguese', "title" || ' ' || "heading" || ' ' || "content"))
        WHERE "language" = 'pt'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_ai_knowledge_chunks_search_pt"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_ai_knowledge_chunks_search_en"`);
    await q.query(`ALTER TABLE "ai_knowledge_chunks" DROP COLUMN IF EXISTS "countries"`);
    await q.query(`ALTER TABLE "ai_knowledge_chunks" DROP COLUMN IF EXISTS "language"`);
  }
}
