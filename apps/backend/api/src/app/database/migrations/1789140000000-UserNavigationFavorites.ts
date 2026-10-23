import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Los destinos del menú que cada persona marca como favoritos, en cada empresa.
 *
 * ## Para qué
 *
 * El menú de un ERP es largo y cada persona vive en cinco o seis pantallas de él. Los favoritos son
 * esas pantallas a un clic desde cualquier módulo. Se guardan en el servidor —y no solo en el
 * navegador— por la misma razón que el espacio de trabajo: quien los fija en la oficina los espera
 * en casa.
 *
 * ## Por qué una fila por favorito y no una lista en un JSON
 *
 * Añadir y quitar son operaciones sueltas que llegan de equipos distintos. Con una fila por
 * favorito, añadir en el portátil y quitar otro en la oficina no pueden pisarse: cada uno toca su
 * fila, y la restricción única hace que añadir dos veces el mismo sea inofensivo. Una lista en un
 * solo campo obligaría a resolver conflictos por revisión, como el espacio de trabajo, para algo
 * que no los necesita.
 *
 * ## Qué se guarda
 *
 * La ruta del menú (`/accounting/journals`), nunca un documento ni datos de negocio, y su posición.
 * El rótulo y el icono los pone el cliente desde el manifiesto: así se traducen y siguen al
 * producto si una pantalla cambia de nombre.
 */
export class UserNavigationFavorites1789140000000 implements MigrationInterface {
  name = 'UserNavigationFavorites1789140000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "user_navigation_favorites" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "route" varchar(200) NOT NULL,
        "position" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_navigation_favorites" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_navigation_favorites_owner_route" UNIQUE ("organization_id", "user_id", "route"),
        CONSTRAINT "FK_user_navigation_favorites_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_navigation_favorites_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    // La lectura de siempre: los favoritos de una persona en una empresa, en su orden.
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_navigation_favorites_owner_position"
        ON "user_navigation_favorites" ("organization_id", "user_id", "position")
    `);

    // La política de aislamiento, con la misma forma que las demás tablas de inquilino.
    await q.query(`ALTER TABLE "user_navigation_favorites" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "user_navigation_favorites" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "user_navigation_favorites"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "user_navigation_favorites"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "user_navigation_favorites" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "user_navigation_favorites"`);
  }
}
