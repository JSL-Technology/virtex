import { EntityManager } from 'typeorm';
import { DEFAULT_LANGUAGE, isLanguageCode, mergeTranslations, type LanguageCode, type LocalizedName } from '@virtex/shared/types';
import { Organization } from '../entities/organization.entity';

/**
 * The language a company keeps its books in (`LanguageAxis.Books`): the language of the record —
 * the name a master is filed under, the narratives of its entries, what a filing reads. Fixed at
 * provisioning from the company's country; the product's default language until then.
 *
 * Other modules ask it here rather than reading the organization themselves: what the books
 * language is, and what it is before it is set, is one rule.
 */
export async function organizationBooksLanguage(manager: EntityManager, organizationId: string): Promise<LanguageCode> {
  const organization = await manager.findOne(Organization, {
    where: { id: organizationId },
    select: ['id', 'booksLanguage'],
  });
  const language = organization?.booksLanguage?.slice(0, 2).toLowerCase();
  return isLanguageCode(language) ? language : DEFAULT_LANGUAGE;
}

/**
 * A master's translations once an edit is applied (`mergeTranslations`): the books language — the
 * one its `name` is in — asked only when the edit carries translations to merge, so an edit that
 * says nothing of them costs nothing and keeps them as they were.
 */
export async function translationsAfterEdit(
  manager: EntityManager,
  organizationId: string,
  current: LocalizedName | null | undefined,
  incoming: LocalizedName | null | undefined,
): Promise<LocalizedName> {
  if (incoming === undefined || incoming === null) return { ...(current ?? {}) };
  return mergeTranslations(current, incoming, await organizationBooksLanguage(manager, organizationId));
}
