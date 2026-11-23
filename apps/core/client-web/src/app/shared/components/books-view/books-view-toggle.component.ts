import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LANGUAGE_ENDONYMS } from '@virtex/shared/types';
import { LocaleStore, TranslateModule } from '@virtex/shared/ui-i18n';

let nextId = 0;

/**
 * «Ver como los libros», where the books are read (books bilingual).
 *
 * A reader whose language is not the books' sees account names and the narratives the system
 * wrote in their own language. The accountant preparing a filing, or answering an auditor, needs
 * to see what those will read — the books as they are kept — and needs to find the switch on the
 * screen they are reading, not in their profile. It is the same preference as the one in personal
 * settings (`LocaleStore.booksView`), so turning it on here turns it on everywhere.
 *
 * Shown only when there is something to switch: when the books language is the reader's, both
 * readings are the same.
 */
@Component({
  selector: 'vx-books-view-toggle',
  standalone: true,
  imports: [TranslateModule],
  template: `
    @if (locale.booksLanguageDiffers()) {
      <label class="books-view-toggle" [attr.for]="inputId">
        <input
          type="checkbox"
          [id]="inputId"
          [checked]="locale.booksView()"
          [attr.aria-describedby]="hintId"
          (change)="locale.setBooksView(!locale.booksView())"
        />
        <span>{{ 'accounting.books_view.label' | translate: { language: booksLanguageName() } }}</span>
        <span class="sr-only" [id]="hintId">{{ 'accounting.books_view.hint' | translate: { language: booksLanguageName() } }}</span>
      </label>
    }
  `,
  styleUrls: ['./books-view-toggle.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VxBooksViewToggleComponent {
  protected readonly locale = inject(LocaleStore);
  protected readonly booksLanguageName = computed(() => LANGUAGE_ENDONYMS[this.locale.booksLanguage()]);
  protected readonly inputId = `vx-books-view-${++nextId}`;
  protected readonly hintId = `${this.inputId}-hint`;
}
