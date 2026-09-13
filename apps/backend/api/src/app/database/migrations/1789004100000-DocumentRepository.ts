import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The tenant's document repository: folders and the files in them.
 *
 * The repository screen listed two folders and four files — `Facturas de Proveedores, 15 archivos`,
 * `Reporte_Ventas_Q2_2025.pdf, 2.1 MB` — as literals in the browser bundle, the same six rows for
 * every tenant of the product, with an upload button that uploaded nothing and a search box that
 * filtered a list nobody could add to. The storage service it needed had been there the whole time,
 * serving avatars and journal-entry attachments.
 *
 * One table for folders and files, because a repository is a tree: two tables mean two ways to ask
 * "what is in this folder", and they drift.
 */
export class DocumentRepository1789004100000 implements MigrationInterface {
  name = 'DocumentRepository1789004100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."document_nodes_kind_enum" AS ENUM ('FOLDER', 'FILE');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await q.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."document_nodes_template_type_enum" AS ENUM
          ('NONE', 'INVOICE', 'QUOTE', 'EMAIL', 'CONTRACT', 'OTHER');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "document_nodes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "parent_id" uuid,
        "kind" "public"."document_nodes_kind_enum" NOT NULL,
        "name" character varying(255) NOT NULL,
        "storage_key" text,
        "mime_type" character varying(255),
        "file_size" numeric(18,0) NOT NULL DEFAULT 0,
        "template_type" "public"."document_nodes_template_type_enum" NOT NULL DEFAULT 'NONE',
        "description" text,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_document_nodes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_document_nodes_parent"
          FOREIGN KEY ("parent_id") REFERENCES "document_nodes"("id") ON DELETE CASCADE,
        -- A folder has no bytes and a file cannot be without them. Without this, a failed upload
        -- leaves a row the repository claims to hold and cannot produce.
        CONSTRAINT "CHK_document_nodes_file_has_storage" CHECK (
          ("kind" = 'FOLDER' AND "storage_key" IS NULL)
          OR ("kind" = 'FILE' AND "storage_key" IS NOT NULL)
        )
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_document_nodes_org_parent"
        ON "document_nodes" ("organization_id", "parent_id")
    `);
    // Two nodes cannot share a name in one folder, which is what makes a path mean one thing.
    // Postgres treats NULLs as distinct in a plain unique index, so the root needs its own.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_document_nodes_folder_name"
        ON "document_nodes" ("organization_id", "parent_id", "name")
        WHERE "parent_id" IS NOT NULL
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_document_nodes_root_name"
        ON "document_nodes" ("organization_id", "name")
        WHERE "parent_id" IS NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "document_nodes"`);
    await q.query(`DROP TYPE IF EXISTS "public"."document_nodes_template_type_enum"`);
    await q.query(`DROP TYPE IF EXISTS "public"."document_nodes_kind_enum"`);
  }
}
