import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { LANGUAGE_ENDONYMS, LOCALIZED_NAME_MAX_LENGTH, SUPPORTED_LANGUAGES, type LocalizedName } from '@virtex/shared/types';
import { LocaleStore, TranslateModule } from '@virtex/shared/ui-i18n';

let nextId = 0;

/**
 * A master's name in the languages other than the books' (books bilingual): a journal, a tax, a
 * warehouse, a dimension.
 *
 * The name field beside it is the record, in the books language — what a filing and an export
 * read. These are how the same name reads for someone whose language is another one: one field per
 * language the product speaks, the books' left out. A field left empty is «no translation in that
 * language»: the reader sees the books name there, never a blank.
 *
 * Bound to a form control holding `{ en?: string; pt?: string }`. What it sends keeps every
 * language, the empty ones included, so the server removes a translation a person cleared.
 *
 *     <vx-name-translations formControlName="nameTranslations" />
 */
@Component({
  selector: 'vx-name-translations',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <fieldset class="name-translations">
      <legend>{{ 'common.name_translations.legend' | translate }}</legend>
      <div class="name-translations__grid">
        @for (option of languages(); track option.language) {
          <div class="form-field">
            <label [for]="idOf(option.language)">{{ option.label }}</label>
            <input
              type="text"
              [id]="idOf(option.language)"
              [attr.lang]="option.language"
              [attr.maxlength]="maxLength"
              [attr.aria-describedby]="hintId"
              [value]="values()[option.language] ?? ''"
              [disabled]="disabled()"
              (input)="set(option.language, $any($event.target).value)"
              (blur)="markTouched()"
            />
          </div>
        }
      </div>
      <small class="field-hint" [id]="hintId">{{ 'common.name_translations.hint' | translate: { language: booksLanguageName() } }}</small>
    </fieldset>
  `,
  styleUrls: ['./name-translations.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VxNameTranslationsComponent implements ControlValueAccessor {
  /**
   * Self-injected and wired by hand, as `vx-select` and `vx-date-field` are: declaring
   * `NG_VALUE_ACCESSOR` makes the control and its accessor mutually dependent.
   */
  private readonly ngControl = inject(NgControl, { optional: true, self: true });
  private readonly locale = inject(LocaleStore);

  /** What the inputs' ids start with, so two of these on one page do not share ids. */
  readonly idPrefix = input<string>(`vx-name-translations-${++nextId}`);

  protected readonly maxLength = LOCALIZED_NAME_MAX_LENGTH;
  protected readonly hintId = `vx-name-translations-hint-${nextId}`;
  protected readonly languages = computed(() =>
    SUPPORTED_LANGUAGES.filter((language) => language !== this.locale.booksLanguage()).map((language) => ({
      language,
      label: LANGUAGE_ENDONYMS[language],
    })),
  );
  protected readonly booksLanguageName = computed(() => LANGUAGE_ENDONYMS[this.locale.booksLanguage()]);
  protected readonly values = signal<LocalizedName>({});
  protected readonly disabled = signal(false);

  private onChange: (value: LocalizedName) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  protected idOf(language: string): string {
    return `${this.idPrefix()}-${language}`;
  }

  protected set(language: string, text: string): void {
    const next = { ...this.values(), [language]: text };
    this.values.set(next);
    // Every language this form shows, the empty ones too: an emptied field removes the translation.
    this.onChange(Object.fromEntries(this.languages().map(({ language: shown }) => [shown, (next as Record<string, string>)[shown] ?? ''])));
  }

  protected markTouched(): void {
    this.onTouched();
  }

  writeValue(value: LocalizedName | null | undefined): void {
    this.values.set({ ...(value ?? {}) });
  }

  registerOnChange(fn: (value: LocalizedName) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }
}
