import { Client } from 'pg';

import {
  CLASSIFIED_TABLE_NAMES,
  CROSS_TENANT_TABLES,
  GLOBAL_TABLES,
  INHERITED_TENANT_TABLES,
  MATERIALIZED_VIEWS,
} from '../../apps/backend/api/src/app/shared/tenancy/tenant-table-classification';

/**
 * Proves, against a live database, that the row-level policies isolate tenants.
 *
 * ## Why this is a script and not a unit test
 *
 * There is nothing to mock. The control being verified IS PostgreSQL's behaviour, so a test that
 * stubs the database would assert that the stub works. This connects twice — once as the owner to
 * arrange the data, once as `virtex_app` to read it back — and checks what the second connection can
 * actually see.
 *
 * Run it after `npm run migration:run` against a disposable database:
 *
 *   DB_HOST=... DB_NAME=... npm run verify:rls
 */

const OWNER = {
  host: process.env['DB_HOST'] ?? 'localhost',
  port: Number(process.env['DB_PORT'] ?? 5432),
  user: process.env['DB_USERNAME'] ?? 'postgres',
  password: process.env['DB_PASSWORD'] || undefined,
  database: process.env['DB_NAME'] ?? 'erp',
};

const APP = { ...OWNER, user: 'virtex_app', password: process.env['APP_DB_PASSWORD'] || undefined };

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`}`);
}

async function main() {
  const owner = new Client(OWNER);
  await owner.connect();

  // Arrange. The script owns its fixtures and clears them first, so running it twice says the same
  // thing as running it once — a verification that only passes on a pristine database verifies
  // nothing anybody can re-check.
  await owner.query(`DELETE FROM customers WHERE organization_id IN ($1, $2)`, [ORG_A, ORG_B]);
  await owner.query(`
    INSERT INTO organizations (id, legal_name, slug)
    VALUES ($1,'Empresa A','empresa-a-rls'), ($2,'Empresa B','empresa-b-rls')
    ON CONFLICT (id) DO NOTHING`, [ORG_A, ORG_B]);

  for (const [org, tag] of [[ORG_A, 'A'], [ORG_B, 'B']] as const) {
    await owner.query(
      `INSERT INTO customers (id, organization_id, email, "companyName")
       VALUES (uuid_generate_v4(), $1, $2, $3)`,
      [org, `cliente-${tag}@example.com`, `Cliente de ${tag}`],
    );
  }

  const totals = await owner.query(`SELECT count(*)::int AS n FROM customers`);
  console.log(`\n  Datos: ${totals.rows[0].n} clientes en total, repartidos entre dos empresas.\n`);

  const app = new Client(APP);
  await app.connect();

  // 1. No tenant context: nothing is visible. Absent context must mean no rows, never all rows.
  const blind = await app.query(`SELECT count(*)::int AS n FROM customers`);
  check('sin contexto de empresa no se ve ninguna fila', blind.rows[0].n, 0);

  // 2. Each tenant sees exactly its own.
  for (const [org, tag] of [[ORG_A, 'A'], [ORG_B, 'B']] as const) {
    await app.query(`SELECT set_config('app.current_organization', $1, false)`, [org]);
    const rows = await app.query(`SELECT "companyName" FROM customers ORDER BY 1`);
    check(`la empresa ${tag} ve solo sus clientes`, rows.rows.map((r) => r.companyName), [`Cliente de ${tag}`]);
  }

  // 3. Writing into another tenant is refused, not silently accepted.
  await app.query(`SELECT set_config('app.current_organization', $1, false)`, [ORG_A]);
  let refused = false;
  try {
    await app.query(
      `INSERT INTO customers (id, organization_id, email, "companyName")
       VALUES (uuid_generate_v4(), $1, 'intruso@example.com', 'Intruso')`,
      [ORG_B],
    );
  } catch (e) {
    refused = /row-level security/i.test((e as Error).message);
  }
  check('insertar en otra empresa es rechazado', refused, true);

  // 4. Updating somebody else's row cannot reach it at all.
  const updated = await app.query(
    `UPDATE customers SET "companyName" = 'Secuestrado' WHERE organization_id = $1`,
    [ORG_B],
  );
  check('actualizar filas de otra empresa no alcanza ninguna', updated.rowCount, 0);

  // 5. Child rows inherit the boundary: a line is only reachable through its own document.
  const invoiceA = await owner.query(
    `SELECT id FROM invoices WHERE organization_id = $1 LIMIT 1`, [ORG_A],
  );
  if (invoiceA.rows.length) {
    await app.query(`SELECT set_config('app.current_organization', $1, false)`, [ORG_B]);
    const lines = await app.query(
      `SELECT count(*)::int AS n FROM invoice_line_item WHERE "invoiceId" = $1`,
      [invoiceA.rows[0].id],
    );
    check('las líneas de una factura ajena no son visibles', lines.rows[0].n, 0);
  } else {
    console.log('  · sin facturas de ejemplo: la herencia de líneas se comprueba por su política');
    const policy = await owner.query(
      `SELECT count(*)::int AS n FROM pg_policies
       WHERE tablename = 'invoice_line_item' AND policyname = 'tenant_isolation'`,
    );
    check('invoice_line_item tiene política de aislamiento', policy.rows[0].n, 1);
  }

  // 6. Coverage: every table with a mandatory tenant column is protected.
  const unprotected = await owner.query(`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND c.is_nullable = 'NO'
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.tablename = c.table_name AND p.policyname = 'tenant_isolation'
      )
    ORDER BY 1`);
  check('ninguna tabla con empresa obligatoria queda sin política',
    unprotected.rows.map((r) => r.table_name), []);

  // 6-bis. La comprobación de arriba solo puede ver las columnas que se llaman
  // `organization_id`. Catorce tablas se llamaban `"organizationId"` —sus entidades no declaraban
  // `name` y la estrategia por defecto de TypeORM la escribe así—, de modo que ni recibían
  // política ni aparecían como descubiertas: eran invisibles para el único control que las
  // buscaba. Se renombraron, y esto impide que el nombre vuelva a desviarse.
  const camelCase = await owner.query(`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'organizationId'
    ORDER BY 1`);
  check('ninguna tabla nombra la empresa en camelCase',
    camelCase.rows.map((r) => r.table_name), []);

  // ── 6-ter. TODA tabla clasificada, o el build falla ────────────────────────
  //
  // Las dos comprobaciones de arriba preguntan por el NOMBRE de una columna, y ese es el defecto
  // que esta cierra. Una tabla de inquilino cuya columna se llame de otro modo
  // (`consolidation_maps` lleva `parent_organization_id`), una hija que hereda el inquilino de su
  // padre y no tiene columna propia, o una vista materializada, son invisibles para ellas: ni
  // reciben política ni aparecen como descubiertas.
  //
  // Medido cuando se añadió esto: nueve tablas de inquilino sin ninguna política y sin figurar en
  // ningún informe — entre ellas `stock_items`, `stock_movements` y `vendor_payment`.
  //
  // Así que la pregunta se invierte: cada tabla base de `public` tiene que estar en EXACTAMENTE
  // uno de cuatro sitios — con política, heredando de un padre declarado, global por diseño, o
  // fontanería de identidad y tenencia. Lo que no esté en ninguno rompe el build, y añadirla a una
  // lista es una afirmación que alguien firma.
  const allTables = await owner.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY 1`);

  const protectedTables = new Set<string>(
    (await owner.query(
      `SELECT DISTINCT tablename FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'tenant_isolation'`,
    )).rows.map((r: { tablename: string }) => r.tablename),
  );

  const tableNames: string[] = allTables.rows.map((r: { table_name: string }) => r.table_name);

  const unclassified = tableNames
    .filter((table) => !protectedTables.has(table) && !CLASSIFIED_TABLE_NAMES.has(table))
    .sort();

  check('toda tabla está protegida o clasificada explícitamente', unclassified, []);

  // Una entrada de la clasificación que ya no corresponde a ninguna tabla es una lista
  // envejeciendo: se denuncia igual, porque una lista en la que nadie confía deja de leerse.
  const existing = new Set<string>(tableNames);
  const stale = [...CLASSIFIED_TABLE_NAMES].filter((table) => !existing.has(table)).sort();
  check('la clasificación no nombra tablas que ya no existen', stale, []);

  // Y una tabla declarada «sin inquilino» que ADEMÁS lleva política es una contradicción: o la
  // clasificación miente o la política sobra. En ambos casos alguien tiene que mirar.
  const contradictory = [...GLOBAL_TABLES, ...CROSS_TENANT_TABLES]
    .map((entry) => entry.table)
    .filter((table) => protectedTables.has(table))
    .sort();
  check('ninguna tabla declarada sin inquilino lleva política', contradictory, []);

  // Toda hija declarada tiene que tener política de verdad: declararla y no instalarla es
  // exactamente el silencio que esto viene a eliminar.
  const inheritedWithoutPolicy = INHERITED_TENANT_TABLES
    .map((entry) => entry.table)
    .filter((table) => existing.has(table) && !protectedTables.has(table))
    .sort();
  check('toda hija declarada tiene su política instalada', inheritedWithoutPolicy, []);

  // ── 6-quater. Las vistas materializadas, que RLS no puede alcanzar ─────────
  //
  // PostgreSQL no aplica políticas a una vista materializada: guarda sus propias filas, y las
  // políticas de las tablas base no llegan. Su aislamiento depende ENTERAMENTE del `WHERE` de
  // cada consulta, lo que las convierte en la única parte del producto sin red de seguridad.
  //
  // No se arregla con una política, así que se hace explícito: cada una se declara con su columna
  // de inquilino, y aparecer sin declarar rompe el build.
  const matviews = await owner.query(
    `SELECT matviewname FROM pg_matviews WHERE schemaname = 'public' ORDER BY 1`,
  );
  const declaredViews = new Set(MATERIALIZED_VIEWS.map((v) => v.view));
  const undeclaredViews = matviews.rows
    .map((r: { matviewname: string }) => r.matviewname)
    .filter((view: string) => !declaredViews.has(view))
    .sort();
  check('ninguna vista materializada queda sin declarar', undeclaredViews, []);

  for (const view of MATERIALIZED_VIEWS) {
    const column = await owner.query(
      `SELECT count(*)::int AS n
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid AND c.relname = $1 AND c.relkind = 'm'
        WHERE a.attname = $2 AND a.attnum > 0 AND NOT a.attisdropped`,
      [view.view, view.tenantColumn],
    );
    check(`${view.view} conserva su columna de inquilino "${view.tenantColumn}"`, column.rows[0].n, 1);
  }

  console.log(
    `  · ${protectedTables.size} tabla(s) con política; ` +
    `${INHERITED_TENANT_TABLES.length} heredan de un padre declarado; ` +
    `${GLOBAL_TABLES.length} globales por diseño; ` +
    `${CROSS_TENANT_TABLES.length} de identidad/tenencia; ` +
    `${MATERIALIZED_VIEWS.length} vista(s) materializada(s) declarada(s).`,
  );

  await owner.query(`DELETE FROM customers WHERE organization_id IN ($1, $2)`, [ORG_A, ORG_B]);

  await app.end();
  await owner.end();

  console.log(failures === 0
    ? '\n✓ Aislamiento por empresa verificado contra la base de datos.\n'
    : `\n✗ ${failures} comprobaciones fallaron.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
