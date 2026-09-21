import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El identificador de URL, garantizado por la base de datos.
 *
 * ## Por qué un disparador y no «que cada camino se acuerde»
 *
 * `OrganizationsService.create` asigna el slug, y es el único sitio de la aplicación que crea
 * empresas. Pero no es el único sitio que INSERTA en `organizations`: lo hacen también las pruebas
 * de integración del núcleo contable, los guiones de verificación y cualquier reparación de datos
 * hecha a mano. Al añadir la columna NOT NULL, todos esos caminos se rompieron a la vez.
 *
 * Se podía arreglar poniendo el slug en cada uno. Eso vuelve a ser un invariante que depende de
 * que alguien lo recuerde, y el próximo camino nuevo lo olvidará igual. Con el disparador, una
 * empresa sin slug es imposible de expresar: la base lo deriva del nombre y lo hace único.
 *
 * El slug deliberado sigue ganando. El disparador solo actúa cuando llega NULL, así que un alta
 * real —que sí elige— no se ve afectada, y lo que obtiene una inserción directa es un slug válido
 * y arbitrario en vez de un error.
 *
 * ## Por qué la unicidad se resuelve con el id y no con un contador
 *
 * Un contador exige leer para decidir, y dos inserciones concurrentes leerían el mismo número. Los
 * primeros ocho caracteres del uuid ya están decididos antes de escribir, así que no hay carrera;
 * y si aun así colisionara, el índice único rechaza la fila, que es la respuesta correcta.
 */
export class OrganizationSlugBackstop1789006300000 implements MigrationInterface {
  name = 'OrganizationSlugBackstop1789006300000';

  public async up(q: QueryRunner): Promise<void> {
    // `translate` en vez de la extensión `unaccent`: no está instalada, y añadir una dependencia
    // de despliegue por una red de seguridad no se sostiene. Cubre las vocales acentuadas y la
    // eñe, que es lo que aparece en un nombre de empresa en español o portugués.
    await q.query(`
      CREATE OR REPLACE FUNCTION virtex_slugify(source text)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      AS $$
        SELECT COALESCE(
          NULLIF(
            regexp_replace(
              regexp_replace(
                lower(translate(source,
                  'áàâãäéèêëíìîïóòôõöúùûüýñçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÝÑÇ',
                  'aaaaaeeeeiiiiooooouuuuyncAAAAAEEEEIIIIOOOOOUUUUYNC')),
                '[^a-z0-9]+', '-', 'g'),
              '(^-+)|(-+$)', '', 'g'),
            ''),
          'empresa')
      $$;
    `);

    await q.query(`
      CREATE OR REPLACE FUNCTION virtex_organizations_ensure_slug()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        base text;
        candidate text;
      BEGIN
        IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
          RETURN NEW;
        END IF;

        base := left(virtex_slugify(COALESCE(NEW.commercial_name, NEW.legal_name, 'empresa')), 60);
        candidate := base;

        IF EXISTS (SELECT 1 FROM organizations WHERE slug = candidate) THEN
          -- Los primeros ocho caracteres del uuid: ya están decididos, así que no hay carrera.
          candidate := left(base, 51) || '-' || left(replace(NEW.id::text, '-', ''), 8);
        END IF;

        NEW.slug := candidate;
        RETURN NEW;
      END;
      $$;
    `);

    await q.query(`DROP TRIGGER IF EXISTS organizations_ensure_slug ON "organizations"`);
    await q.query(`
      CREATE TRIGGER organizations_ensure_slug
        BEFORE INSERT ON "organizations"
        FOR EACH ROW
        EXECUTE FUNCTION virtex_organizations_ensure_slug()
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER IF EXISTS organizations_ensure_slug ON "organizations"`);
    await q.query(`DROP FUNCTION IF EXISTS virtex_organizations_ensure_slug()`);
    await q.query(`DROP FUNCTION IF EXISTS virtex_slugify(text)`);
  }
}
