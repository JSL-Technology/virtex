import { EntityManager } from 'typeorm';
import { Role } from './entities/role.entity';
import { RoleEnum } from './enums/role.enum';
import { DEFAULT_ROLES } from '../config/roles.config';
import { replaceRolesInOrganization } from '../users/persistence/identity-writes';
import { InternalServerError } from '../i18n/localized.exception';

/**
 * The roles a new tenant starts with, and its first administrator.
 *
 * Two code paths create tenants — signup and «Crear subsidiaria» — and only signup created the
 * default roles. A subsidiary therefore came into existence with no roles at all: its creator was
 * granted a membership, could switch into it, and then held no permission there, so every screen
 * refused them. Both paths provision through this one function now, so a tenant cannot be created
 * in a state its own creator cannot use.
 */
export async function createDefaultTenantRoles(
  manager: EntityManager,
  organizationId: string,
): Promise<{ roles: Role[]; administrator: Role }> {
  // `save` fills the generated ids into these same instances, so they are what is returned.
  const roles = DEFAULT_ROLES.map((role) => manager.create(Role, { ...role, organizationId }));
  await manager.save(roles);
  const administrator = roles.find((role) => role.name === RoleEnum.ADMINISTRATOR);
  if (!administrator) {
    throw new InternalServerError('auth.default_administrator_role_could_not_found');
  }
  return { roles, administrator };
}

/**
 * The default roles, and the person creating the tenant as its administrator — for an identity
 * that already exists (a subsidiary's owner, an existing user adding a company).
 */
export async function provisionTenantRoles(
  manager: EntityManager,
  organizationId: string,
  firstAdministratorUserId: string,
): Promise<{ roles: Role[]; administrator: Role }> {
  const { roles, administrator } = await createDefaultTenantRoles(manager, organizationId);
  // role-assignment-allow: tenant provisioning. The tenant did not exist a moment ago, the role is
  // the administrator role this call just created inside it, and the person receiving it is the one
  // creating the tenant — at signup after paying for it, or as the owner of the parent company
  // (the subsidiary route requires the owner policy and a step-up). There is no prior actor in this
  // tenant whose rights could be exceeded. Scoped to the new tenant through the join table, so the
  // person's roles anywhere else are neither read nor rewritten.
  await replaceRolesInOrganization(manager, firstAdministratorUserId, organizationId, [administrator.id]);
  return { roles, administrator };
}
