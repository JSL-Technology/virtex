import { DataSource } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { UserOrganization } from '../../organizations/entities/user-organization.entity';
import {
  OrganizationInvitation,
  OrganizationInvitationStatus,
} from '../../organizations/entities/organization-invitation.entity';
import { MembershipService } from '../../organizations/services/membership.service';
import { Role } from '../../roles/entities/role.entity';
import { RolesService } from '../../roles/roles.service';
import { User, UserStatus } from '../entities/user.entity/user.entity';
import { OrganizationInvitationsService } from './organization-invitations.service';
import { expectLocalizedError } from '../../i18n/testing/expect-localized-error';

/**
 * An invitation for an existing account is a REQUEST: nothing is granted until its addressee — and
 * only its addressee — accepts it. Proven against Postgres, because the whole point is which rows
 * exist afterwards.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('OrganizationInvitationsService', () => {
  jest.setTimeout(120_000);

  let ds: DataSource;
  let service: OrganizationInvitationsService;
  let mail: { sendOrganizationInvitationEmail: jest.Mock };
  let orgA: Organization;
  let orgB: Organization;
  let adminRoleB: Role;
  let viewerRoleB: Role;
  let inviter: User;

  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

    const cache = { clearUserSession: jest.fn() };
    const membership = new MembershipService(
      ds.getRepository(UserOrganization),
      ds.getRepository(Organization),
      cache as never,
      ds,
    );
    mail = { sendOrganizationInvitationEmail: jest.fn() };
    const roles = new RolesService(ds.getRepository(Role), cache as never, { has: () => false } as never);
    service = new OrganizationInvitationsService(
      ds.getRepository(OrganizationInvitation),
      membership,
      mail as never,
      cache as never,
      { enforceLimit: jest.fn() } as never,
      ds,
      roles,
    );

    orgA = await ds.getRepository(Organization).save({ legalName: `INV A ${unique()}` } as Organization);
    orgB = await ds.getRepository(Organization).save({ legalName: `INV B ${unique()}` } as Organization);
    adminRoleB = await ds.getRepository(Role).save({ name: `Admin ${unique()}`, permissions: ['*'], organizationId: orgB.id } as Role);
    viewerRoleB = await ds.getRepository(Role).save({ name: `Viewer ${unique()}`, permissions: ['invoices:read'], organizationId: orgB.id } as Role);

    inviter = await ds.getRepository(User).save({
      firstName: 'Admin', lastName: 'B', email: `inviter-${unique()}@example.test`,
      organizationId: orgB.id, status: UserStatus.ACTIVE, roles: [adminRoleB],
    } as unknown as User);
    await membership.grant(inviter.id, orgB.id);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  async function personOfA(): Promise<User> {
    const user = await ds.getRepository(User).save({
      firstName: 'Ana', lastName: 'A', email: `person-${unique()}@example.test`,
      organizationId: orgA.id, status: UserStatus.ACTIVE,
    } as unknown as User);
    await ds.query(`INSERT INTO user_organizations (user_id, organization_id) VALUES ($1, $2)`, [user.id, orgA.id]);
    return user;
  }

  const actor = () => ({ id: inviter.id, permissions: ['*'] }) as never;
  const memberships = async (userId: string) =>
    (await ds.query(`SELECT organization_id FROM user_organizations WHERE user_id = $1`, [userId]))
      .map((r: { organization_id: string }) => r.organization_id);

  it('inviting grants NOTHING: no membership, no role, only a pending request and an email', async () => {
    const person = await personOfA();

    const invitation = await service.invite(person, orgB.id, viewerRoleB, actor());

    expect(invitation?.status).toBe(OrganizationInvitationStatus.PENDING);
    expect(await memberships(person.id)).toEqual([orgA.id]);
    expect(mail.sendOrganizationInvitationEmail).toHaveBeenCalled();
    expect((await service.listReceived(person.id)).map((i) => i.id)).toEqual([invitation!.id]);
  });

  it('re-inviting refreshes the pending request instead of stacking a second one', async () => {
    const person = await personOfA();
    const first = await service.invite(person, orgB.id, viewerRoleB, actor());
    const second = await service.invite(person, orgB.id, viewerRoleB, actor());
    expect(second!.id).toBe(first!.id);
  });

  it('only the addressee can accept, and acceptance grants exactly the membership and the role', async () => {
    const person = await personOfA();
    const other = await personOfA();
    const invitation = await service.invite(person, orgB.id, viewerRoleB, actor());

    await expectLocalizedError(service.accept(invitation!.id, other.id), 'users.invitation_not_found_or_expired');
    expect(await memberships(other.id)).toEqual([orgA.id]);

    await service.accept(invitation!.id, person.id);

    expect((await memberships(person.id)).sort()).toEqual([orgA.id, orgB.id].sort());
    const roles = await ds.query(`SELECT role_id FROM user_roles WHERE user_id = $1`, [person.id]);
    expect(roles.map((r: { role_id: string }) => r.role_id)).toEqual([viewerRoleB.id]);
  });

  it('an invitation cannot be answered twice', async () => {
    const person = await personOfA();
    const invitation = await service.invite(person, orgB.id, viewerRoleB, actor());
    await service.accept(invitation!.id, person.id);
    await expectLocalizedError(service.accept(invitation!.id, person.id), 'users.invitation_not_found_or_expired');
  });

  it('declining grants nothing and removes it from the list', async () => {
    const person = await personOfA();
    const invitation = await service.invite(person, orgB.id, viewerRoleB, actor());
    await service.decline(invitation!.id, person.id);
    expect(await memberships(person.id)).toEqual([orgA.id]);
    expect(await service.listReceived(person.id)).toEqual([]);
  });

  it('an expired invitation cannot be accepted', async () => {
    const person = await personOfA();
    const invitation = await service.invite(person, orgB.id, viewerRoleB, actor());
    await ds.query(`UPDATE organization_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [invitation!.id]);
    await expectLocalizedError(service.accept(invitation!.id, person.id), 'users.invitation_not_found_or_expired');
  });

  it('is refused at acceptance if the inviter no longer may grant the role', async () => {
    const person = await personOfA();
    const invitation = await service.invite(person, orgB.id, adminRoleB, actor());
    // The inviter is suspended in B after sending it.
    await ds.query(`UPDATE user_organizations SET suspended_at = now() WHERE user_id = $1 AND organization_id = $2`, [inviter.id, orgB.id]);
    try {
      await expectLocalizedError(service.accept(invitation!.id, person.id), 'users.invitation_not_found_or_expired');
      expect(await memberships(person.id)).toEqual([orgA.id]);
    } finally {
      await ds.query(`UPDATE user_organizations SET suspended_at = NULL WHERE user_id = $1 AND organization_id = $2`, [inviter.id, orgB.id]);
    }
  });

  it('a tenant can withdraw only the invitations it sent', async () => {
    const person = await personOfA();
    const invitation = await service.invite(person, orgB.id, viewerRoleB, actor());
    await expectLocalizedError(service.revoke(invitation!.id, orgA.id), 'users.invitation_not_found_or_expired');
    await service.revoke(invitation!.id, orgB.id);
    expect(await service.listReceived(person.id)).toEqual([]);
  });

  it('refuses to record an invitation for a role the actor could not grant', async () => {
    const person = await personOfA();
    await expect(
      service.invite(person, orgB.id, adminRoleB, { id: inviter.id, permissions: ['invoices:read'] } as never),
    ).rejects.toThrow();
  });
});
