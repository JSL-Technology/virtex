import { ChangeDetectorRef, OnDestroy, Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { isNarrativeRef, renderNarrative, type NarrativeRenderer } from '@virtex/shared/types';
import { FormatService } from './format.service';
import { LocaleStore } from './locale.store';
import { VirtexTranslateStore } from './translate-store';

/** What the last call rendered, and for which reading of the screen. */
interface Rendered {
  text: string | null | undefined;
  key: string | null | undefined;
  params: Record<string, unknown> | null | undefined;
  language: string;
  out: string;
}

/**
 * A narrative the system wrote on an entry or a line, in the language the company's data is shown
 * in (books bilingual).
 *
 * `text` is the record: what the books wrote, in their language. When the reader's language is
 * another one — and they did not ask to see the books as they are kept — the narrative is rendered
 * from the message it was written from (`renderNarrative`, shared with the server's rules): its own
 * narratives nested inside it, an account's name in the reader's language, a catalogue key
 * translated. Whatever cannot be rendered — no message kept, a key this build's catalogue does not
 * hold — shows the record, whole: a narrative half in one language is worse than one wholly in the
 * books'. Nothing here ever changes the record.
 *
 *     {{ line.description | vxNarrative: line.descriptionKey : line.descriptionParams }}
 *
 * Impure, like `translate`, because the reading changes without the inputs changing: the reader
 * switches language, the catalogue finishes loading, the books view is turned on. What it rendered
 * last is kept, so a ledger of a thousand lines does not re-render a thousand messages on every
 * change detection.
 */
@Pipe({ name: 'vxNarrative', standalone: true, pure: false })
export class VxNarrativePipe implements PipeTransform, OnDestroy {
  private readonly store = inject(LocaleStore);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  /** Whether a key exists, asked of the store every render walks; absent, nothing is rendered. */
  private readonly catalogue = inject(VirtexTranslateStore, { optional: true });
  private readonly refresh: Subscription;
  private last: Rendered | null = null;

  private readonly renderer: NarrativeRenderer = {
    message: (key, values) => {
      const language = this.translate.getCurrentLang();
      if (!language || !this.catalogue?.hasKey(language, key)) return null;
      const rendered: unknown = this.translate.instant(key, this.format.localizeParams(values));
      return typeof rendered === 'string' ? rendered : null;
    },
    name: (value) => this.store.nameOf(value),
  };

  constructor() {
    // The view the pipe renders in; none when code, not a template, uses it.
    const changes = inject(ChangeDetectorRef, { optional: true });
    // A language switched or a catalogue loaded: what was rendered may be in the wrong language,
    // or may now be renderable.
    this.refresh = this.translate.onTranslationRefresh.subscribe(() => {
      this.last = null;
      changes?.markForCheck();
    });
  }

  transform(text: string | null | undefined, key?: string | null, params?: Record<string, unknown> | null): string {
    const recorded = text ?? '';
    // Read before any early return, so the view depends on all three whichever way this goes.
    const language = this.store.language();
    const booksView = this.store.booksView();
    const differs = this.store.booksLanguageDiffers();
    if (!key || booksView || !differs) return recorded;

    const last = this.last;
    if (last && last.text === text && last.key === key && last.params === params && last.language === language) {
      return last.out;
    }
    const ref = { key, params: params ?? {} };
    const rendered = isNarrativeRef(ref) ? renderNarrative(ref, this.renderer) : null;
    // Only a rendering is kept: the record shown because the catalogue was not there yet must give
    // way to the rendering once it is.
    this.last = rendered === null ? null : { text, key, params, language, out: rendered };
    return rendered ?? recorded;
  }

  ngOnDestroy(): void {
    this.refresh.unsubscribe();
  }
}
