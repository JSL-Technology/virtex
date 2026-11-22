import { Pipe, PipeTransform, inject } from '@angular/core';
import { LocaleStore } from './locale.store';

/**
 * An account's own name, in the language the company's data is shown in — the reader's, or the
 * books' when they asked to see the books as an auditor does (`LocaleStore.booksView`).
 *
 * Account names are stored as `{ es: 'Efectivo en caja', en: 'Cash on hand' }`, because a tenant
 * operating across Latin America and the United States keeps one chart of accounts and two
 * audiences for it. Templates were reaching into that object with `name.es`, which pins every
 * reader to Spanish, or printing it whole, which renders `[object Object]`.
 *
 * The fallback chain is deliberate: the data language, then the books language, then whatever
 * single translation exists. A name is never blank, because an account with no readable name is
 * worse than one in the wrong language.
 */
@Pipe({ name: 'vxName', standalone: true, pure: false })
export class VxLocalizedNamePipe implements PipeTransform {
  private readonly store = inject(LocaleStore);

  /**
   * `translations` for a master that keeps its name as text in the books language and its other
   * languages beside it: `{{ journal.name | vxName: journal.nameTranslations }}`.
   */
  transform(value: Record<string, string> | string | null | undefined, translations?: Record<string, string> | null): string {
    return this.store.nameOf(value, translations);
  }
}
