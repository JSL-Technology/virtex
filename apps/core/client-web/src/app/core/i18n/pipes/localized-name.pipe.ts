import { Pipe, PipeTransform, inject } from '@angular/core';
import { LocaleStore } from '../locale.store';

/**
 * An account's own name, in the reader's language.
 *
 * Account names are stored as `{ es: 'Efectivo en caja', en: 'Cash on hand' }`, because a tenant
 * operating across Latin America and the United States keeps one chart of accounts and two
 * audiences for it. Templates were reaching into that object with `name.es`, which pins every
 * reader to Spanish, or printing it whole, which renders `[object Object]`.
 *
 * The fallback chain is deliberate: the reader's language, then the language the tenant most
 * likely wrote in, then whatever single translation exists. A name is never blank, because an
 * account with no readable name is worse than one in the wrong language.
 */
@Pipe({ name: 'vxName', standalone: true, pure: false })
export class VxLocalizedNamePipe implements PipeTransform {
  private readonly store = inject(LocaleStore);

  transform(value: Record<string, string> | string | null | undefined): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;

    const locale = this.store.locale();
    const language = locale.split('-')[0];

    return (
      value[locale] ??
      value[language] ??
      value['es'] ??
      value['en'] ??
      Object.values(value).find((candidate) => Boolean(candidate)) ??
      ''
    );
  }
}
