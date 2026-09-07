import { Client } from 'pg';

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
    INSERT INTO organizations (id, legal_name) VALUES ($1,'Empresa A'), ($2,'Empresa B')
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
