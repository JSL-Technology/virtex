import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The same rule the entities declare (`@Check`): written here as a literal, as migrations are.
 *
 * Both `IS NOT NULL` are needed, not decoration: a CHECK passes when it evaluates to NULL, and
 * `jsonb_typeof(NULL) = 'object'` is NULL — without them a message with no values was accepted.
 */
const NARRATIVE_CHECK =
  `("description_key" IS NULL AND "description_params" IS NULL) OR ` +
  `("description_key" IS NOT NULL AND "description_params" IS NOT NULL ` +
  `AND "description_key" ~ '^[a-z0-9][a-z0-9_]*(\\.[a-z0-9_]+)+$' AND jsonb_typeof("description_params") = 'object')`;

/**
 * The narratives the system writes on entries, with the message they were written from.
 *
 * `description` stays the record: written once, in the books language, what an auditor and a
 * filing read. `description_key` and `description_params` are the message and its values, so a
 * reader in another language sees the same narrative in theirs — a US controller of a Dominican
 * company reads «Depreciation 2026-10 — AF-2026-000001 Crane» where the books say «Depreciación
 * 2026-10 — AF-2026-000001 Grúa». Null for what a person typed, and for every entry posted before:
 * which message wrote them was not kept, and is not guessed here.
 */
export class EntryNarratives1789820000000 implements MigrationInterface {
  name = 'EntryNarratives1789820000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of ['journal_entries', 'journal_entry_lines']) {
      await q.query(`ALTER TABLE "${table}" ADD COLUMN "description_key" character varying(160)`);
      await q.query(`ALTER TABLE "${table}" ADD COLUMN "description_params" jsonb`);
      // A message without its values, or values without a message, is neither; and a message is a
      // catalogue key with its values by name — what the screen renders it from.
      await q.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "CHK_${table}_description_narrative" CHECK (${NARRATIVE_CHECK})`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['journal_entry_lines', 'journal_entries']) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "CHK_${table}_description_narrative"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "description_params"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "description_key"`);
    }
  }
}
