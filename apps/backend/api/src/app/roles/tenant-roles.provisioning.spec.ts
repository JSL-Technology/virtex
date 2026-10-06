import { DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { User, UserStatus } from '../users/entities/user.entity/user.entity';
import { Role } from './entities/role.entity';
import { RoleEnum } from './enums/role.enum';
import { DEFAULT_ROLES } from '../config/roles.config';
import { provisionTenantRoles } from './tenant-roles.provisioning';

/**
 * A subsidiary used to be created with no roles, so its creator could switch into it and do
 * nothing there. Every new tenant is provisioned through the same function now.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('provisionTenantRoles', () => {
  jest.setTimeout(60_000);
  let ds: DataSource;
  const orgs: string[] = [];

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
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await ds.initialize();
  });

  afterAll(async () => {
    if (orgs.length) await ds.getRepository(Organization).delete(orgs);
    await ds?.destroy();
  });

  const roleNamesOf = async (userId: string, organizationId: string): Promise<string[]> => {
    const rows = await ds
      .createQueryBuilder()
      .select('role.name', 'name')
      .from('user_roles', 'ur')
      .innerJoin(Role, 'role', 'role.id = ur.role_id')
      .where('ur.user_id = :userId', { userId })
      .andWhere('role.organizationId = :organizationId', { organizationId })
      .getRawMany<{ name: string }>();
    return rows.map((row) => row.name);
  };

  it('creates the default roles in the new tenant and makes its creator administrator there only', async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const home = await ds.getRepository(Organization).save({ legalName: `Matriz ${stamp}` } as Organization);
    const created = await ds.getRepository(Organization).save({ legalName: `Filial ${stamp}` } as Organization);
    orgs.push(home.id, created.id);
    const homeRole = await ds
      .getRepository(Role)
      .save({ name: `Contador ${stamp}`, permissions: ['invoices:view'], organizationId: home.id } as Role);
    const owner = await ds.getRepository(User).save({
      firstName: 'Ana',
      lastName: 'Pérez',
      email: `tr-${stamp}@example.test`,
      organizationId: home.id,
      status: UserStatus.ACTIVE,
      roles: [homeRole],
    } as unknown as User);

    const { roles, administrator } = await ds.transaction((manager) =>
      provisionTenantRoles(manager, created.id, owner.id),
    );

    expect(roles.map((role) => role.name).sort()).toEqual(DEFAULT_ROLES.map((role) => role.name).sort());
    expect(roles.every((role) => role.organizationId === created.id)).toBe(true);
    expect(administrator.name).toBe(RoleEnum.ADMINISTRATOR);
    expect(await roleNamesOf(owner.id, created.id)).toEqual([RoleEnum.ADMINISTRATOR]);
    //  Their role in the company they came from is untouched.
    expect(await roleNamesOf(owner.id, home.id)).toEqual([homeRole.name]);
  });
});
