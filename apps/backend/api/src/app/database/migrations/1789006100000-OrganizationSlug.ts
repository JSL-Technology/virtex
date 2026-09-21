import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Un identificador de empresa que puede ir en una URL.
 *
 * ## Para qué
 *
 * La empresa activa vivía únicamente en el token de acceso, y cambiarla significaba emitir tokens
 * nuevos (`POST /organizations/switch`). Con eso, dos empresas a la vez son imposibles: el token
 * lo comparten todas las pestañas del navegador, así que cambiar de empresa en una cambia en
 * silencio la empresa en la que escriben las demás. Una pestaña que muestra los libros de una
 * empresa y postea en los de otra no es una incomodidad: es un asiento en el libro equivocado.
 *
 * Poner la empresa en la ruta la convierte en parte de la identidad de la pantalla, que es lo que
 * ya es conceptualmente. Para eso hace falta un identificador que una persona pueda leer y
 * escribir: `/e/nortex-comercial/accounting/journal-entries` y no
 * `/e/9f1c.../accounting/journal-entries`.
 *
 * ## Por qué NOT NULL y único, en dos pasos
 *
 * La columna se añade opcional, se rellena a partir del nombre legal y solo entonces se vuelve
 * obligatoria. Añadirla NOT NULL de golpe rompería cualquier base que ya tenga filas —y esa es
 * exactamente la familia de fallos que `verify:upgrade-path` acaba de empezar a vigilar—.
 *
 * El índice único es sobre la columna entera, no por región ni por plan: un slug ambiguo no es
 * un slug. Los duplicados de nombre se resuelven con un sufijo numérico, que es visible y estable,
 * en vez de con el uuid, que no se puede dictar por teléfono.
 */
export class OrganizationSlug1789006100000 implements MigrationInterface {
  name = 'OrganizationSlug1789006100000';

  /**
   * De nombre legal a slug.
   *
   * Se hace en TypeScript y no en SQL porque quitar acentos en Postgres exige la extensión
   * `unaccent`, que no está instalada y que no merece una dependencia de despliegue para esto.
   *
   * Es una copia CONGELADA de `slugifyOrganizationName`, no una importación, y eso es
   * deliberado: una migración tiene que producir el mismo resultado hoy que dentro de dos años.
   * Si importara la regla viva, cambiarla haría que replicar las migraciones sobre una base nueva
   * generase slugs distintos de los que tiene una base antigua, y el enlace de una empresa
   * dependería de cuándo se creó su base de datos. El código en ejecución usa el módulo
   * compartido; esto es historia.
   */
  private slugify(name: string): string {
    const base = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '');
    // Una empresa cuyo nombre es solo signos —existe— necesita algo que sí sea un slug.
    return base || 'empresa';
  }

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "slug" character varying(80)`);

    const rows: Array<{ id: string; legal_name: string | null; commercial_name: string | null }> =
      await q.query(
        `SELECT "id", "legal_name", "commercial_name" FROM "organizations" WHERE "slug" IS NULL
         ORDER BY "created_at" NULLS LAST, "id"`,
      );

    const taken = new Set<string>(
      (await q.query(`SELECT "slug" FROM "organizations" WHERE "slug" IS NOT NULL`)).map(
        (r: { slug: string }) => r.slug,
      ),
    );

    for (const row of rows) {
      // El nombre comercial primero: es el que la gente usa para referirse a la empresa.
      const base = this.slugify(row.commercial_name || row.legal_name || 'empresa');
      let slug = base;
      let n = 1;
      while (taken.has(slug)) {
        n += 1;
        slug = `${base.slice(0, 60 - String(n).length - 1)}-${n}`;
      }
      taken.add(slug);
      await q.query(`UPDATE "organizations" SET "slug" = $1 WHERE "id" = $2`, [slug, row.id]);
    }

    await q.query(`ALTER TABLE "organizations" ALTER COLUMN "slug" SET NOT NULL`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_organizations_slug" ON "organizations" ("slug")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_organizations_slug"`);
    await q.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "slug"`);
  }
}
