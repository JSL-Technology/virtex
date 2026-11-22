import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LANGUAGE_ENDONYMS, isLanguageCode } from '@virtex/shared/types';
import { LocaleStore, TranslateModule } from '@virtex/shared/ui-i18n';
import { ExportLanguagePreference } from '../../../core/export/export-language';
import type { StatementLanguage } from '../../../core/export/statement-export.service';

let nextId = 0;

/**
 * «Exportar en…» beside a statement's export button: the reader's language, the books', or both
 * (books bilingual). Shown only where there is a choice — when the books are kept in a language
 * other than the reader's.
 */
@Component({
  selector: 'vx-export-language',
  standalone: true,
  imports: [TranslateModule],
  template: `
    @if (locale.booksLanguageDiffers()) {
      <label class="export-language" [attr.for]="id">
        <span>{{ 'reports.export.language_label' | translate }}</span>
        <select [id]="id" [value]="preference.language()" (change)="choose($any($event.target).value)">
          <option value="reader" [selected]="preference.language() === 'reader'">
            {{ 'reports.export.language_reader' | translate: { language: readerName() } }}
          </option>
          <option value="books" [selected]="preference.language() === 'books'">
            {{ 'reports.export.language_books' | translate: { language: booksName() } }}
          </option>
          <option value="bilingual" [selected]="preference.language() === 'bilingual'">
            {{ 'reports.export.language_bilingual' | translate: { books: booksName(), reader: readerName() } }}
          </option>
        </select>
      </label>
    }
  `,
  styles: [
    `
      :host { display: inline-flex; }
      .export-language { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--content-secondary); }
      .export-language select { min-width: 9rem; }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VxExportLanguageComponent {
  protected readonly locale = inject(LocaleStore);
  protected readonly preference = inject(ExportLanguagePreference);
  protected readonly id = `vx-export-language-${++nextId}`;
  protected readonly booksName = computed(() => LANGUAGE_ENDONYMS[this.locale.booksLanguage()]);
  protected readonly readerName = computed(() => {
    const language = this.locale.language();
    return isLanguageCode(language) ? LANGUAGE_ENDONYMS[language] : language;
  });

  protected choose(value: string): void {
    this.preference.set(value as StatementLanguage);
  }
}
