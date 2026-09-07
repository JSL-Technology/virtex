import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { Customer } from '../../apps/backend/api/src/app/customers/entities/customer.entity';
import { runInTenantContext } from '../../apps/backend/api/src/app/shared/tenancy/tenant-context';
import { getRepositoryToken } from '@nestjs/typeorm';

/**
 * Proves that tenant isolation holds THROUGH the application, not just in the database.
 *
 * `verify:rls` shows the policies isolate correctly when psql sets the variable by hand. That is a
 * statement about PostgreSQL. This is the statement that matters: that a service using an ordinary
 * `@InjectRepository` repository, issuing a query with NO tenant filter of its own, still sees only
 * its own tenant — because the request was pinned to a connection carrying the setting.
 *
 * Run it against a disposable database, with DB_USERNAME pointing at `virtex_app`:
 *
 *   DB_USERNAME=virtex_app npm run verify:rls-runtime
 *
 * Connecting as the table owner makes every check pass for the wrong reason — the owner bypasses
 * the policies — so the script refuses to run as owner rather than report a false success.
 */
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${name}` +
      (ok ? '' : `\n      esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`),
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const dataSource = app.get(DataSource);
  const repo = app.get<Repository<Customer>>(getRepositoryToken(Customer));

  const role: Array<{ current_user: string }> = await dataSource.query(`SELECT current_user`);
  console.log(`\n  Conectado como: ${role[0].current_user}`);
  if (role[0].current_user !== 'virtex_app') {
    console.error(
      '\n✗ Este script debe correr como virtex_app. Como dueño de las tablas las políticas no ' +
        'aplican y todas las comprobaciones pasarían por el motivo equivocado.\n',
    );
    await app.close();
    process.exit(1);
  }

  /** What the interceptor does, without an HTTP request to hang it on. */
  async function asTenant<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query(`SELECT set_config('app.current_organization', $1, false)`, [organizationId]);
    try {
      return await runInTenantContext(
        { organizationId, manager: dataSource.createEntityManager(runner) },
        fn,
      );
    } finally {
      await runner.query(`RESET app.current_organization`);
      await runner.release();
    }
  }

  // Arrange as each tenant, which also proves writes land under the right policy.
  for (const [org, tag] of [[ORG_A, 'A'], [ORG_B, 'B']] as const) {
    await asTenant(org, async () => {
      await repo.delete({ organizationId: org });
      await repo.save(
        repo.create({
          organizationId: org,
          email: `runtime-${tag}@example.com`,
          companyName: `Cliente de ${tag}`,
        } as Partial<Customer>),
      );
    });
  }

  // 1. The query carries NO tenant filter. Anything it returns, the database decided to show.
  for (const [org, tag] of [[ORG_A, 'A'], [ORG_B, 'B']] as const) {
    const names = await asTenant(org, async () => (await repo.find()).map((c) => c.companyName));
    check(`repositorio sin filtro: la empresa ${tag} ve solo lo suyo`, names.sort(), [
      `Cliente de ${tag}`,
    ]);
  }

  // 2. Asking explicitly for the other tenant's rows returns nothing, rather than returning them.
  const stolen = await asTenant(ORG_A, async () =>
    repo.find({ where: { organizationId: ORG_B } }),
  );
  check('pedir explícitamente las filas de otra empresa devuelve cero', stolen.length, 0);

  // 3. A query builder — the path most services use for anything non-trivial — obeys too.
  const viaBuilder = await asTenant(ORG_B, async () =>
    repo.createQueryBuilder('c').select('c.companyName', 'name').getRawMany(),
  );
  check('el query builder también obedece', viaBuilder.map((r) => r.name), ['Cliente de B']);

  // 4. `dataSource.transaction` — 96 call sites — must run on the pinned connection, not a fresh one.
  const inTransaction = await asTenant(ORG_A, async () =>
    dataSource.transaction(async (manager) =>
      (await manager.find(Customer)).map((c) => c.companyName),
    ),
  );
  check('dataSource.transaction usa la conexión de la petición', inTransaction, ['Cliente de A']);

  // 5. Outside any tenant context the policies deny, so a leak cannot hide in a background job that
  //    forgot to establish one: it returns nothing and is noticed, rather than returning everything.
  const outside = await repo.find();
  check('fuera de contexto de empresa no se ve nada', outside.length, 0);

  // Clean up under each tenant's own policy.
  for (const org of [ORG_A, ORG_B]) {
    await asTenant(org, async () => {
      await repo.delete({ organizationId: org });
    });
  }

  await app.close();
  console.log(
    failures === 0
      ? '\n✓ Aislamiento verificado a través de la aplicación, no solo de la base.\n'
      : `\n✗ ${failures} comprobaciones fallaron.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
