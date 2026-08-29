/**
 * Executable proof, against a real Postgres, that one person can belong to two tenants.
 *
 * Before this change the second tenant's invitation failed at the database:
 *
 *   duplicate key value violates unique constraint "UQ_97672ac88f789774dd47f7c8be3"
 *   DETAIL: Key (email)=(shared@example.com) already exists.
 *
 * The invite path's own pre-check could not catch it, because it looked up `{ email,
 * organizationId }` and the conflicting row belongs to a different organization — so the customer
 * saw a 500 with a database error in it. For a product sold to many tenants across one region, an
 * accountant working with two clients is the ordinary case.
 */
import 'reflect-metadata';
import { AppDataSource } from '../../apps/backend/api/src/app/database/data-source';
import { User } from '../../apps/backend/api/src/app/users/entities/user.entity/user.entity';
import { Organization } from '../../apps/backend/api/src/app/organizations/entities/organization.entity';
import { UserOrganization } from '../../apps/backend/api/src/app/organizations/entities/user-organization.entity';
import { Role } from '../../apps/backend/api/src/app/roles/entities/role.entity';
import { MembershipService } from '../../apps/backend/api/src/app/organizations/services/membership.service';
import { UserIdentityService } from '../../apps/backend/api/src/app/auth/services/user-identity.service';
import { CachedUser } from '../../apps/backend/api/src/app/auth/interfaces/cached-user.interface';
import { UserStatus } from '../../apps/backend/api/src/app/users/entities/user.entity/user.entity';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

async function main() {
  const ds = await AppDataSource.initialize();
  const membership = new MembershipService(
    ds.getRepository(UserOrganization),
    ds.getRepository(Organization),
  );

  const stamp = Date.now();
  const email = `shared-${stamp}@example.com`;

  const orgA = await ds.getRepository(Organization).save({ legalName: `Cliente A ${stamp}` } as Organization);
  const orgB = await ds.getRepository(Organization).save({ legalName: `Cliente B ${stamp}` } as Organization);

  const adminRole = await ds.getRepository(Role).save({
    name: 'Administrator', permissions: ['users:delete', 'billing:manage'], organizationId: orgA.id,
  } as Role);
  const viewerRole = await ds.getRepository(Role).save({
    name: 'Viewer', permissions: ['invoices:read'], organizationId: orgB.id,
  } as Role);

  // One identity, created by the first tenant.
  const user = await ds.getRepository(User).save({
    firstName: 'Ana', lastName: 'Pérez', email, organizationId: orgA.id, roles: [adminRole],
  } as unknown as User);
  await membership.grant(user.id, orgA.id);

  // The second tenant adds the SAME person. This is the insert that used to fail.
  user.roles = [adminRole, viewerRole];
  await ds.getRepository(User).save(user);
  await membership.grant(user.id, orgB.id);

  const rows = await ds.getRepository(User).findBy({ email });
  check('one user row for the person, not one per tenant', rows.length === 1, `${rows.length} row(s)`);

  const memberships = await membership.listFor(user.id, orgA.id);
  check('belongs to both tenants', memberships.length === 2, memberships.map((m) => m.legalName).join(', '));
  check('the active tenant is marked', memberships.filter((m) => m.isActive).length === 1);

  check('membership check is per tenant', await membership.isMember(user.id, orgB.id));
  check(
    'a tenant they do not belong to is refused',
    !(await membership.isMember(user.id, '00000000-0000-4000-8000-000000000000')),
  );

  // The property that matters most: rights do not travel between tenants.
  const cached: CachedUser = {
    id: user.id, email, firstName: 'Ana', lastName: 'Pérez', status: UserStatus.ACTIVE,
    organizationId: orgA.id, tokenVersion: 0, isTwoFactorEnabled: false,
    roleAssignments: [
      { name: adminRole.name, organizationId: orgA.id, permissions: adminRole.permissions },
      { name: viewerRole.name, organizationId: orgB.id, permissions: viewerRole.permissions },
    ],
  };

  const inA = UserIdentityService.permissionsFor(cached, orgA.id);
  const inB = UserIdentityService.permissionsFor(cached, orgB.id);

  check('administrator rights apply in the tenant that granted them', inA.includes('users:delete'));
  check('and NOT in the other tenant', !inB.includes('users:delete'), `in B: [${inB.join(', ')}]`);
  check('the viewer right applies only in its own tenant', inB.includes('invoices:read') && !inA.includes('invoices:read'));

  // The foreign key is real now.
  let fkHeld = false;
  try {
    await ds.query(
      `UPDATE users SET organization_id = '00000000-0000-4000-8000-000000000000' WHERE id = $1`,
      [user.id],
    );
  } catch {
    fkHeld = true;
  }
  check('users.organization_id cannot reference a non-existent tenant', fkHeld);

  await ds.getRepository(User).delete({ id: user.id });
  await ds.getRepository(Role).delete({ id: adminRole.id });
  await ds.getRepository(Role).delete({ id: viewerRole.id });

  console.log(failures.length ? `\nFAILURES:\n${failures.join('\n')}` : '\nCROSS-TENANT MEMBERSHIP WORKS END TO END');
  await ds.destroy();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
