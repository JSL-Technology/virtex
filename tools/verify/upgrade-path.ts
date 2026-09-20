/**
 * Ensaya un despliegue de ACTUALIZACIÓN, no una instalación desde cero.
 *
 * ## Qué dejó pasar la comprobación que ya había
 *
 * CI ejecuta `npm run migration:run` contra una base vacía, y su propio comentario dice que eso
 * «prueba que las migraciones siguen aplicándose limpiamente desde la nada, que es exactamente lo
 * que hace un despliegue». La segunda mitad de la frase no es cierta: un despliegue de
 * actualización aplica migraciones sobre una base **que ya tiene inquilinos**.
 *
 * `PayrollModule1789003000000` tiene un paso 5 titulado «provisionar inquilinos existentes» cuyo
 * bucle solo tiene cuerpo si `organizations` tiene filas. Con la base vacía da cero vueltas y sus
 * consultas ni se planifican. Sobre una base con inquilinos fallaba cuatro veces seguidas —cada
 * arreglo destapaba el siguiente— y nadie lo habría sabido hasta el despliegue.
 *
 * ## Cómo lo prueba
 *
 * Aplica las migraciones en orden sobre una base propia y, en cuanto `organizations` existe,
 * inserta un inquilino sintético. El resto de las migraciones se aplican encima. Basta un
 * inquilino vacío: los errores de este tipo son de análisis, no de ejecución —Postgres rechaza la
 * consulta al planificarla—, así que salen aunque el inquilino no tenga ni una cuenta.
 *
 * De paso cubre la otra familia de fallos de actualización: una columna NOT NULL sin valor por
 * defecto añadida a una tabla que ya tiene filas.
 *
 * Es deliberadamente independiente del orden: no lleva escrito en qué migración hay que insertar
 * el inquilino, así que una migración nueva que provisione inquilinos queda cubierta sin que nadie
 * tenga que acordarse de nada.
 */
import 'reflect-metadata';
import { Client } from 'pg';
import { DataSource, MigrationInterface } from 'typeorm';

import { AppDataSource } from '../../apps/backend/api/src/app/database/data-source';

const PROBE_DB = process.env['UPGRADE_PROBE_DB'] ?? 'virteex_upgrade_probe';
const ORG_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const options = AppDataSource.options as { host?: string; port?: number; username?: string; password?: string; database?: string };

const admin = () =>
  new Client({
    host: options.host,
    port: options.port,
    user: options.username,
    password: options.password,
    database: 'postgres',
  });

/** Las columnas NOT NULL sin defecto que tenga `organizations` en este punto de la historia. */
async function insertTenant(ds: DataSource): Promise<void> {
  const columns: Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }> =
    await ds.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'organizations'`,
    );

  const values: Record<string, unknown> = { id: ORG_ID };
  for (const c of columns) {
    if (c.column_name === 'id' || c.is_nullable === 'YES' || c.column_default !== null) continue;
    // Un valor mínimo y válido para cada tipo. No se pretende que el inquilino sea realista:
    // se pretende que exista, que es la condición que activa los pasos de provisión.
    switch (c.data_type) {
      case 'character varying':
      case 'text':
        values[c.column_name] = `upgrade-probe-${c.column_name}`;
        break;
      case 'boolean':
        values[c.column_name] = false;
        break;
      case 'integer':
      case 'bigint':
      case 'numeric':
      case 'double precision':
        values[c.column_name] = 0;
        break;
      case 'timestamp with time zone':
      case 'timestamp without time zone':
      case 'date':
        values[c.column_name] = new Date().toISOString();
        break;
      case 'jsonb':
      case 'json':
        values[c.column_name] = '{}';
        break;
      case 'uuid':
        // Una clave ajena obligatoria a otra tabla no se puede inventar; se deja que falle
        // diciendo cuál es, que es información útil, en vez de insertar un id que no existe.
        throw new Error(
          `organizations."${c.column_name}" es un uuid obligatorio sin defecto: el ensayo de ` +
          `actualización no puede inventar a qué apunta. Dale un defecto o hazla opcional.`,
        );
      default:
        throw new Error(`tipo no contemplado en el ensayo de actualización: ${c.data_type}`);
    }
  }

  const names = Object.keys(values);
  await ds.query(
    `INSERT INTO "organizations" (${names.map((n) => `"${n}"`).join(', ')})
     VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT ("id") DO NOTHING`,
    names.map((n) => values[n]),
  );
}

async function main() {
  const a = admin();
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS "${PROBE_DB}" WITH (FORCE)`);
  await a.query(`CREATE DATABASE "${PROBE_DB}"`);
  await a.end();

  const ds = new DataSource({ ...(AppDataSource.options as never), database: PROBE_DB, logging: false });
  await ds.initialize();

  let applied = 0;
  let tenantInserted = false;
  const failures: string[] = [];

  // TypeORM crea esta tabla dentro de `runMigrations()`, y aquí las migraciones se aplican una a
  // una para poder intercalar la inserción del inquilino, así que hay que crearla a mano.
  await ds.query(`
    CREATE TABLE IF NOT EXISTS "migrations" (
      "id" SERIAL PRIMARY KEY,
      "timestamp" bigint NOT NULL,
      "name" character varying NOT NULL
    )
  `);
  // La otra tabla de contabilidad interna de TypeORM: la necesita cualquier migración que cree
  // una vista, y la crea también dentro de `runMigrations()`.
  await ds.query(`
    CREATE TABLE IF NOT EXISTS "typeorm_metadata" (
      "type" character varying NOT NULL,
      "database" character varying,
      "schema" character varying,
      "table" character varying,
      "name" character varying,
      "value" text
    )
  `);

  // `ds.migrations` llega en el orden en que el glob encontró los ficheros, no en orden
  // cronológico, y las instancias que devuelve son `MigrationInterface` —no el envoltorio
  // `Migration` de TypeORM—, así que no traen `timestamp`: hay que leerlo del nombre de la clase,
  // que es de donde TypeORM lo saca también. Aplicarlas en el orden del glob no probaría una
  // actualización: probaría otra cosa.
  const stampOf = (m: MigrationInterface): number => {
    const name = m.name ?? m.constructor.name;
    const digits = /(\d{13,})$/.exec(name);
    if (!digits) throw new Error(`la migración "${name}" no termina en su marca de tiempo`);
    return Number(digits[1]);
  };
  const ordered = [...ds.migrations].sort((x, y) => stampOf(x) - stampOf(y));

  try {
    for (const migration of ordered) {
      const name = migration.name ?? migration.constructor.name;
      const runner = ds.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await migration.up(runner);
        await runner.query(`INSERT INTO "migrations"("timestamp", "name") VALUES ($1, $2)`, [
          stampOf(migration),
          name,
        ]);
        await runner.commitTransaction();
        applied += 1;
      } catch (e) {
        await runner.rollbackTransaction();
        failures.push(`${name}: ${(e as Error).message}`);
        console.error(`✗ ${name}\n    ${(e as Error).message}`);
        break;
      } finally {
        await runner.release();
      }

      if (!tenantInserted) {
        const exists: Array<{ n: string }> = await ds.query(
          `SELECT count(*)::int AS n FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'organizations'`,
        );
        if (Number(exists[0].n) > 0) {
          await insertTenant(ds);
          tenantInserted = true;
          console.log(`  · inquilino sintético insertado tras ${name}`);
        }
      }
    }
  } finally {
    await ds.destroy();
    // `UPGRADE_PROBE_KEEP=true` conserva la base para poder inspeccionarla cuando falla: sin eso,
    // diagnosticar una migración que solo se rompe en la ruta de actualización obliga a
    // reconstruir el escenario a mano.
    if (process.env['UPGRADE_PROBE_KEEP'] !== 'true') {
      const b = admin();
      await b.connect();
      await b.query(`DROP DATABASE IF EXISTS "${PROBE_DB}" WITH (FORCE)`);
      await b.end();
    } else {
      console.log(`  · base "${PROBE_DB}" conservada para inspección`);
    }
  }

  if (!tenantInserted) {
    console.error('\n✗ Nunca se creó la tabla `organizations`: el ensayo no probó nada.');
    process.exit(1);
  }

  console.log(
    failures.length === 0
      ? `\n✓ Las ${applied} migraciones se aplican sobre una base que ya tiene un inquilino.\n`
      : `\n✗ La actualización se detiene en:\n  - ${failures.join('\n  - ')}\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
