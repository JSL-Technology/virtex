import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El espacio de trabajo de cada persona en cada empresa, guardado en el servidor.
 *
 * ## Para qué
 *
 * Las pestañas abiertas, su orden y la disposición de ventanas vivían solo en `localStorage`. Eso
 * cubre F5 y cerrar el navegador, y no cubre lo que la gente hace de verdad: empezar un cierre
 * contable en la oficina y seguirlo en casa. Cada equipo era un espacio de trabajo distinto sin
 * que nada lo dijera.
 *
 * ## Por qué la clave es (usuario, empresa)
 *
 * Porque un espacio de trabajo es de una persona EN una empresa. La misma persona llevando los
 * libros de dos sociedades tiene dos conjuntos de pestañas, y mezclarlos sería poner los
 * documentos de una en la ventana de la otra. Es la misma razón por la que la clave de
 * `localStorage` se acotó por empresa.
 *
 * ## Por qué hay una revisión
 *
 * Dos equipos abiertos a la vez escriben el mismo espacio. Con «el último gana», el portátil
 * cierra en silencio las pestañas que acababas de abrir en el de la oficina. La revisión permite
 * al servidor decir «esto cambió desde lo que tú viste» y devolver lo que tiene, para que el
 * cliente una los dos conjuntos en vez de descartar uno.
 *
 * ## Qué NO se guarda
 *
 * Datos de negocio. La carga es metadatos de pestaña —ruta, título, icono, posición de scroll— y
 * el estado serializable de la vista. Un espacio de trabajo no es una copia de los documentos: es
 * la lista de los que estaban abiertos. Eso mantiene la fila pequeña y evita que cerrar sesión en
 * un equipo filtre el contenido de un documento a otro.
 */
export class UserWorkspace1789006200000 implements MigrationInterface {
  name = 'UserWorkspace1789006200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "user_workspaces" (
        "user_id"         uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "schema_version"  integer NOT NULL,
        "revision"        integer NOT NULL DEFAULT 1,
        "payload"         jsonb NOT NULL,
        "updated_at"      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_workspaces" PRIMARY KEY ("user_id", "organization_id"),
        CONSTRAINT "FK_user_workspaces_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_workspaces_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    // En cascada por las dos claves a propósito: borrar una empresa o una persona se lleva sus
    // espacios de trabajo. Una fila huérfana aquí no es un dato que nadie vaya a reclamar.

    // La política, con la misma forma que las otras 118. Sin ella, esta tabla sería el agujero
    // número 33 — y `verify:rls` la nombraría, que es justamente por lo que ahora está en CI.
    const setting = `NULLIF(current_setting('app.current_organization', true), '')`;
    await q.query(`ALTER TABLE "user_workspaces" ENABLE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "user_workspaces"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "user_workspaces"
        USING (organization_id = ${setting}::uuid)
        WITH CHECK (organization_id = ${setting}::uuid)
    `);

    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "user_workspaces" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "user_workspaces"`);
  }
}
