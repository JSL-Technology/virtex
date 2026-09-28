import { DataSource } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Role } from '../../roles/entities/role.entity';
import { User, UserStatus } from '../entities/user.entity/user.entity';
import { replaceRolesInOrganization, saveIdentity } from './identity-writes';

/**
 * Against a real Postgres, because the defect lived in how TypeORM synchronises a `ManyToMany`,
 * which a mocked repository cannot reproduce.
 *
 * The first test documents the mechanism: a plain `save` of a user whose roles were loaded for
 * one tenant deletes the roles it holds in every other. The rest prove the two writers do not.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('identity writes', () => {
  jest.setTimeout(120_000);

  let ds: DataSource;
  let orgA: Organization;
  let orgB: Organization;
  let roleA: Role;
  let roleB: Role;
  let roleB2: Role;

  const loadScoped = (userId: string, organizationId: string) =>
    ds
      .getRepository(User)
      .createQueryBuilder('user')
      .leftJoinAndSelect(
        'user.roles',
        'roles',
        'roles.organizationId = :organizationId OR roles.organizationId IS NULL',
        { organizationId },
      )
      .where('user.id = :userId', { userId })
      .getOneOrFail();

  const roleIdsOf = async (userId: string) =>
    (
      await ds.query(`SELECT role_id FROM user_roles WHERE user_id = $1 ORDER BY role_id`, [userId])
    ).map((row: { role_id: string }) => row.role_id).sort();

  beforeAll(async () => {
    ds = new DataSource({
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
    await ds.initialize();

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgA = await ds.getRepository(Organization).save({ legalName: `IW A ${stamp}` } as Organization);
    orgB = await ds.getRepository(Organization).save({ legalName: `IW B ${stamp}` } as Organization);
    roleA = await ds.getRepository(Role).save({ name: `Admin A ${stamp}`, permissions: ['*'], organizationId: orgA.id } as Role);
    roleB = await ds.getRepository(Role).save({ name: `Viewer B ${stamp}`, permissions: ['invoices:read'], organizationId: orgB.id } as Role);
    roleB2 = await ds.getRepository(Role).save({ name: `Editor B ${stamp}`, permissions: ['invoices:edit'], organizationId: orgB.id } as Role);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  async function personInBothTenants(): Promise<User> {
    const email = `iw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    return ds.getRepository(User).save({
      firstName: 'Ana',
      lastName: 'Pérez',
      email,
      organizationId: orgA.id,
      status: UserStatus.ACTIVE,
      roles: [roleA, roleB],
    } as unknown as User);
  }

  it('the defect: a plain save of a tenant-scoped user deletes its roles elsewhere', async () => {
    const person = await personInBothTenants();
    const scoped = await loadScoped(person.id, orgB.id);
    scoped.firstName = 'Changed';

    await ds.getRepository(User).save(scoped);

    expect(await roleIdsOf(person.id)).toEqual([roleB.id]);
  });

  it('saveIdentity changes the attributes and leaves every role where it was', async () => {
    const person = await personInBothTenants();
    const scoped = await loadScoped(person.id, orgB.id);
    scoped.firstName = 'Changed';

    await saveIdentity(ds.manager, scoped);

    expect(await roleIdsOf(person.id)).toEqual([roleA.id, roleB.id].sort());
    const reloaded = await ds.getRepository(User).findOneByOrFail({ id: person.id });
    expect(reloaded.firstName).toBe('Changed');
    expect(scoped.roles.map((r) => r.id)).toEqual([roleB.id]);
  });

  it('replaceRolesInOrganization swaps the role in one tenant and never touches the other', async () => {
    const person = await personInBothTenants();

    await replaceRolesInOrganization(ds.manager, person.id, orgB.id, [roleB2.id]);

    expect(await roleIdsOf(person.id)).toEqual([roleA.id, roleB2.id].sort());
  });

  it('an empty list removes this tenant\'s roles only', async () => {
    const person = await personInBothTenants();

    await replaceRolesInOrganization(ds.manager, person.id, orgB.id, []);

    expect(await roleIdsOf(person.id)).toEqual([roleA.id]);
  });

  it('refuses to assign, from one tenant, a role that belongs to another', async () => {
    const person = await personInBothTenants();

    await expect(
      replaceRolesInOrganization(ds.manager, person.id, orgB.id, [roleA.id]),
    ).rejects.toThrow(/belong to the organization/);
    expect(await roleIdsOf(person.id)).toEqual([roleA.id, roleB.id].sort());
  });
});
