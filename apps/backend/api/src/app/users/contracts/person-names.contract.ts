import { EntityManager, In } from 'typeorm';
import { User } from '../entities/user.entity/user.entity';

/**
 * Display names of people, by id — what a document shows as "created by" or "posted by". Exposed
 * as a contract so modules do not import the identity entity to print a name.
 */
export async function personDisplayNames(
  manager: EntityManager,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const users = await manager.find(User, {
    where: { id: In(wanted) },
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(users.map((user) => [user.id, `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()]));
}
