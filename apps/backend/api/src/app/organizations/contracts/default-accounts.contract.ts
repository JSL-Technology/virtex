import { EntityManager } from 'typeorm';
import { OrganizationSettings } from '../entities/organization-settings.entity';

/**
 * The company's default posting accounts, readable by any module without importing the settings
 * entity. Only the keys a caller names are read, so the contract does not leak the whole row.
 */
export type DefaultAccountKey = Extract<
  {
    [K in keyof OrganizationSettings]-?: K extends `default${string}Id`
      ? OrganizationSettings[K] extends string | null | undefined
        ? K
        : never
      : never;
  }[keyof OrganizationSettings],
  string
>;

export async function organizationDefaultAccounts<K extends DefaultAccountKey>(
  manager: EntityManager,
  organizationId: string,
  keys: readonly K[],
): Promise<Record<K, string | null>> {
  const settings = await manager.findOne(OrganizationSettings, {
    where: { organizationId },
    select: Object.fromEntries([['id', true], ...keys.map((key) => [key, true])]) as never,
  });
  return Object.fromEntries(keys.map((key) => [key, (settings?.[key] as string | null | undefined) ?? null])) as Record<K, string | null>;
}
