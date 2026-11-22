import { Check, Column } from 'typeorm';

/**
 * A master's name in the languages other than the books' (books bilingual): `{ en: 'Sales journal',
 * pt: 'Diário de vendas' }` beside a `name` of «Diario de ventas».
 *
 * The master's own `name` stays the record — what the books, the exports and a filing read, in the
 * books language — and nothing here replaces it. A reader in another language reads the
 * translation, where there is one (`namesOf`, `mergeTranslations` in `@virtex/shared/types`).
 */
export function NameTranslationsColumn(): PropertyDecorator {
  return Column({ name: 'name_translations', type: 'jsonb', default: {} });
}

/** The table's rule for the column: an object of names by language, never a list or a text. */
export function NameTranslationsCheck(table: string): ClassDecorator {
  return Check(`CHK_${table}_name_translations`, `jsonb_typeof("name_translations") = 'object'`);
}
