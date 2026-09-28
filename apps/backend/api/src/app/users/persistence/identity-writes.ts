import { EntityManager } from 'typeorm';
import { User } from '../entities/user.entity/user.entity';
import { Role } from '../../roles/entities/role.entity';

/**
 * Las dos únicas formas de escribir una identidad, y el motivo de que sean dos funciones y no un
 * `save`.
 *
 * ## El defecto que esto cierra
 *
 * `users` es GLOBAL: una persona tiene una identidad aunque trabaje para varias empresas, y sus
 * roles en todas ellas cuelgan de la misma relación `User.roles` (`user_roles`). Las lecturas
 * administrativas cargan esa relación FILTRADA a la empresa que administra — es lo correcto: una
 * empresa no debe ver los roles que la persona tiene en otra —.
 *
 * El problema aparece al guardar. Para una relación `ManyToMany`, TypeORM (0.3.x) recarga de la
 * base de datos TODOS los ids de la relación (`SubjectDatabaseEntityLoader`, sin filtro) y borra de
 * la tabla intermedia los que no estén en el array en memoria (`ManyToManySubjectBuilder`,
 * `removedJunctionEntityIds`). Con el array filtrado, un `save` de cualquier campo —el nombre, el
 * estado, el avatar de uno mismo— borraba los roles de la persona en TODAS las demás empresas.
 * Desde la empresa B se podía dejar sin administrador a la empresa A.
 *
 * `UsersService.remove` ya esquivaba el problema recargando los roles sin filtro; los otros siete
 * caminos no. Un invariante que depende de que cada llamador se acuerde es un invariante que
 * falla, así que ahora hay un sitio y `npm run verify:identity-writes` rechaza cualquier otro.
 */

/**
 * Guarda los atributos de una identidad (y su `security`, en cascada) SIN tocar sus roles.
 *
 * La relación se retira del objeto durante el `save` —con `undefined` TypeORM no la sincroniza— y
 * se restaura después, de modo que quien llama sigue teniendo el objeto tal como lo cargó.
 */
export async function saveIdentity(manager: EntityManager, user: User): Promise<User> {
  const holder = user as { roles?: Role[] };
  const hadRoles = Object.prototype.hasOwnProperty.call(holder, 'roles');
  const roles = holder.roles;
  delete holder.roles;
  try {
    await manager.save(User, user);
  } finally {
    if (hadRoles) holder.roles = roles;
  }
  return user;
}

/**
 * Sustituye los roles de una persona EN UNA EMPRESA, sin mirar ni tocar los de las demás.
 *
 * Escribe la tabla intermedia directamente: primero lee qué roles de ESA empresa tiene hoy la
 * persona, y luego añade y retira exactamente la diferencia. Los roles de otras empresas y los de
 * plataforma (`organization_id` nulo) no entran en ninguna de las dos listas.
 *
 * Todos los roles pedidos tienen que ser de la empresa: un id de otra lanza, porque asignar desde B
 * un rol de A es exactamente la escritura cruzada que esto existe para impedir.
 */
export async function replaceRolesInOrganization(
  manager: EntityManager,
  userId: string,
  organizationId: string,
  roleIds: readonly string[],
): Promise<void> {
  const wanted = [...new Set(roleIds)];

  if (wanted.length) {
    const owned = await manager
      .getRepository(Role)
      .createQueryBuilder('role')
      .select('role.id', 'id')
      .where('role.id IN (:...ids)', { ids: wanted })
      .andWhere('role.organizationId = :organizationId', { organizationId })
      .getRawMany<{ id: string }>();
    if (owned.length !== wanted.length) {
      throw new Error(
        'replaceRolesInOrganization: every role must belong to the organization being administered',
      );
    }
  }

  const current = await manager
    .createQueryBuilder()
    .select('ur.role_id', 'roleId')
    .from('user_roles', 'ur')
    .innerJoin(Role, 'role', 'role.id = ur.role_id')
    .where('ur.user_id = :userId', { userId })
    .andWhere('role.organizationId = :organizationId', { organizationId })
    .getRawMany<{ roleId: string }>();

  const currentIds = current.map((row) => row.roleId);
  const toAdd = wanted.filter((id) => !currentIds.includes(id));
  const toRemove = currentIds.filter((id) => !wanted.includes(id));

  if (!toAdd.length && !toRemove.length) return;

  // tenant-scope-guard-allow: the join table for ONE user, and `toAdd`/`toRemove` were both
  // computed above from roles filtered to `organizationId`, so nothing outside it is touched.
  await manager
    .createQueryBuilder()
    .relation(User, 'roles')
    .of(userId)
    .addAndRemove(toAdd, toRemove);
}
