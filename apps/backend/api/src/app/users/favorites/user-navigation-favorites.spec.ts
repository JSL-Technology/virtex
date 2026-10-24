import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { UserNavigationFavorite } from './user-navigation-favorite.entity';
import { MAX_FAVORITES, UserNavigationFavoritesService } from './user-navigation-favorites.service';

/**
 * Los favoritos del menú, contra la base de datos de verdad.
 *
 * Lo que hay que garantizar lo decide la base de datos —la restricción única, el bloqueo que
 * serializa las escrituras de una persona, el reordenado en una sola sentencia—, así que un
 * repositorio simulado probaría la simulación. Mismo criterio que el espacio de trabajo.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('los favoritos del menú guardados en el servidor', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let service: UserNavigationFavoritesService;
  let userId: string;
  let otherUserId: string;
  let organizationId: string;
  let otherOrganizationId: string;

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
    service = new UserNavigationFavoritesService(
      dataSource.getRepository(UserNavigationFavorite),
      dataSource,
    );

    const suffix = randomUUID();
    const orgs = await Promise.all(
      ['a', 'b'].map((tag) =>
        dataSource.query(`INSERT INTO organizations (legal_name, slug) VALUES ($1, $2) RETURNING id`, [
          `Favorites Test Org ${tag} ${suffix}`,
          `favorites-test-${tag}-${suffix}`,
        ]),
      ),
    );
    const users = await Promise.all(
      ['a', 'b'].map((tag) =>
        dataSource.query(`INSERT INTO users ("firstName", "lastName", email) VALUES ($1, $2, $3) RETURNING id`, [
          'Favorites',
          'Test',
          `favorites-test-${tag}-${suffix}@example.invalid`,
        ]),
      ),
    );
    [organizationId, otherOrganizationId] = orgs.map(([row]) => row.id);
    [userId, otherUserId] = users.map(([row]) => row.id);
  });

  afterAll(async () => {
    for (const id of [userId, otherUserId].filter(Boolean)) {
      await dataSource?.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    for (const id of [organizationId, otherOrganizationId].filter(Boolean)) {
      await dataSource?.query(`DELETE FROM organizations WHERE id = $1`, [id]);
    }
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM user_navigation_favorites WHERE user_id = ANY($1)`, [
      [userId, otherUserId],
    ]);
  });

  it('empieza vacío', async () => {
    expect(await service.list(userId, organizationId)).toEqual([]);
  });

  it('añade al final y conserva el orden', async () => {
    await service.add(userId, organizationId, '/accounting/journals');
    const routes = await service.add(userId, organizationId, '/invoices');
    expect(routes).toEqual(['/accounting/journals', '/invoices']);
  });

  it('añadir dos veces el mismo no lo duplica', async () => {
    await service.add(userId, organizationId, '/invoices');
    expect(await service.add(userId, organizationId, '/invoices')).toEqual(['/invoices']);
  });

  it('quitar renumera, y quitar lo que no está no hace nada', async () => {
    for (const route of ['/a', '/b', '/c']) await service.add(userId, organizationId, route);
    expect(await service.remove(userId, organizationId, '/b')).toEqual(['/a', '/c']);
    expect(await service.remove(userId, organizationId, '/nope')).toEqual(['/a', '/c']);
    // Y lo siguiente que se añade va detrás, sin chocar con una posición vieja.
    expect(await service.add(userId, organizationId, '/d')).toEqual(['/a', '/c', '/d']);
  });

  it('un reordenado de un equipo atrasado no resucita lo quitado ni pierde lo añadido', async () => {
    for (const route of ['/a', '/b', '/c']) await service.add(userId, organizationId, route);
    // Otro equipo quitó «/a» y añadió «/d» después de que este leyera la lista.
    await service.remove(userId, organizationId, '/a');
    await service.add(userId, organizationId, '/d');

    const routes = await service.reorder(userId, organizationId, ['/c', '/a', '/b']);

    expect(routes).toEqual(['/c', '/b', '/d']);
    expect(await service.list(userId, organizationId)).toEqual(['/c', '/b', '/d']);
  });

  it(`no pasa de ${MAX_FAVORITES}, ni siquiera con altas simultáneas`, async () => {
    for (let i = 0; i < MAX_FAVORITES - 3; i++) await service.add(userId, organizationId, `/r${i}`);

    // Diez altas a la vez desde «varios equipos»: sin el bloqueo, varias verían hueco y pasarían.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => service.add(userId, organizationId, `/burst${i}`)),
    );

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(7);
    expect((rejected[0] as PromiseRejectedResult).reason.messageKey).toBe('shell.favorites.limit');
    const routes = await service.list(userId, organizationId);
    expect(routes).toHaveLength(MAX_FAVORITES);
    // Las posiciones son únicas y seguidas: ninguna alta simultánea tomó la misma.
    const positions = await dataSource.query(
      `SELECT position FROM user_navigation_favorites WHERE user_id = $1 ORDER BY position`,
      [userId],
    );
    expect(positions.map((p: { position: number }) => p.position)).toEqual(
      Array.from({ length: MAX_FAVORITES }, (_, i) => i),
    );
  });

  it('los favoritos de una persona no se ven desde otra, ni desde otra empresa', async () => {
    await service.add(userId, organizationId, '/invoices');
    await service.add(otherUserId, organizationId, '/customers');
    await service.add(userId, otherOrganizationId, '/products');

    expect(await service.list(userId, organizationId)).toEqual(['/invoices']);
    expect(await service.list(otherUserId, organizationId)).toEqual(['/customers']);
    expect(await service.list(userId, otherOrganizationId)).toEqual(['/products']);
    // Y quitar en una empresa no toca la otra.
    await service.remove(userId, organizationId, '/products');
    expect(await service.list(userId, otherOrganizationId)).toEqual(['/products']);
  });
});
