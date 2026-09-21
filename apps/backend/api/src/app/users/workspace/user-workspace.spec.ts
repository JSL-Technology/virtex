import { DataSource } from 'typeorm';

import { UserWorkspace } from './user-workspace.entity';
import { UserWorkspaceService, WorkspaceConflict, WorkspaceRead } from './user-workspace.service';

/**
 * El espacio de trabajo en el servidor, contra la base de datos de verdad.
 *
 * ## Por qué esto no puede ser una prueba con dobles
 *
 * Lo único que hay que garantizar aquí es la concurrencia: que dos equipos escribiendo el mismo
 * registro no se pisen en silencio. Eso lo decide la base de datos —la condición vive en el
 * `WHERE` del UPDATE— así que un repositorio simulado probaría la simulación.
 *
 * Y la forma de lo que devuelve el driver tampoco se puede simular con provecho: la primera
 * versión de este servicio leía la fila del `RETURNING`, y `query()` devuelve las filas para un
 * INSERT y `[filas, contador]` para un UPDATE. El camino de actualización leía el contador como si
 * fuera una fila y respondía 500. Compilaba, y una prueba con dobles habría pasado.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('el espacio de trabajo guardado en el servidor', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let service: UserWorkspaceService;
  let userId: string;
  let organizationId: string;

  const isConflict = (r: WorkspaceRead | WorkspaceConflict): r is WorkspaceConflict =>
    'conflict' in r;

  const payloadWith = (routes: string[]) => ({
    schemaVersion: 3,
    activeTabId: routes[0] ?? null,
    tabs: routes.map((route) => ({ id: route, route })),
  });

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();

    service = new UserWorkspaceService(dataSource.getRepository(UserWorkspace));

    // Un usuario y una empresa reales: las dos claves ajenas son en cascada, así que inventar
    // identificadores no serviría.
    const [org] = await dataSource.query(
      `SELECT id FROM organizations ORDER BY created_at NULLS LAST LIMIT 1`,
    );
    const [user] = await dataSource.query(`SELECT id FROM users LIMIT 1`);
    organizationId = org?.id;
    userId = user?.id;
  });

  afterAll(async () => {
    if (userId && organizationId) await service?.forget(userId, organizationId);
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await service.forget(userId, organizationId);
  });

  it('sin nada guardado, la lectura es null y no un registro vacío', async () => {
    expect(await service.read(userId, organizationId)).toBeNull();
  });

  it('la primera escritura crea la revisión 1', async () => {
    const result = await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/invoices']),
      baseRevision: 0,
    });

    expect(isConflict(result)).toBe(false);
    expect((result as WorkspaceRead).revision).toBe(1);
  });

  it('actualizar con la revisión correcta la sube', async () => {
    await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/invoices']),
      baseRevision: 0,
    });

    const result = await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/invoices', '/products']),
      baseRevision: 1,
    });

    expect(isConflict(result)).toBe(false);
    expect((result as WorkspaceRead).revision).toBe(2);
    const stored = (await service.read(userId, organizationId)) as WorkspaceRead;
    expect((stored.payload as { tabs: unknown[] }).tabs).toHaveLength(2);
  });

  it('un segundo equipo que cree que no hay nada recibe conflicto, no sobrescribe', async () => {
    await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/invoices']),
      baseRevision: 0,
    });

    const result = await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/products']),
      baseRevision: 0,
    });

    expect(isConflict(result)).toBe(true);
    // Y lo que había sigue ahí: es la diferencia entre unir y perder el trabajo del otro equipo.
    const stored = (await service.read(userId, organizationId)) as WorkspaceRead;
    expect((stored.payload as { tabs: Array<{ route: string }> }).tabs[0].route).toBe('/invoices');
  });

  it('escribir con una revisión vieja recibe conflicto con lo que hay', async () => {
    await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/a']),
      baseRevision: 0,
    });
    await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/a', '/b']),
      baseRevision: 1,
    });

    const result = await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith([]),
      baseRevision: 1, // la que este equipo vio hace dos escrituras
    });

    expect(isConflict(result)).toBe(true);
    const conflict = result as WorkspaceConflict;
    expect(conflict.current.revision).toBe(2);
    expect((conflict.current.payload as { tabs: unknown[] }).tabs).toHaveLength(2);
  });

  it('tras un conflicto, reintentar con la revisión devuelta funciona', async () => {
    await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/a']),
      baseRevision: 0,
    });
    const conflict = (await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/b']),
      baseRevision: 0,
    })) as WorkspaceConflict;

    const retry = await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/a', '/b']),
      baseRevision: conflict.current.revision,
    });

    expect(isConflict(retry)).toBe(false);
    expect((retry as WorkspaceRead).revision).toBe(2);
  });

  it('dos escrituras concurrentes con la misma revisión: una gana y la otra recibe conflicto', async () => {
    await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/base']),
      baseRevision: 0,
    });

    const [uno, dos] = await Promise.all([
      service.write(userId, organizationId, {
        schemaVersion: 3,
        payload: payloadWith(['/base', '/uno']),
        baseRevision: 1,
      }),
      service.write(userId, organizationId, {
        schemaVersion: 3,
        payload: payloadWith(['/base', '/dos']),
        baseRevision: 1,
      }),
    ]);

    // Exactamente una. Si las dos ganaran, la condición no estaría en el UPDATE y una habría
    // pisado a la otra sin decirlo.
    expect([isConflict(uno), isConflict(dos)].filter(Boolean)).toHaveLength(1);
  });

  it('olvidar deja el registro en null', async () => {
    await service.write(userId, organizationId, {
      schemaVersion: 3,
      payload: payloadWith(['/a']),
      baseRevision: 0,
    });

    await service.forget(userId, organizationId);

    expect(await service.read(userId, organizationId)).toBeNull();
  });
});
