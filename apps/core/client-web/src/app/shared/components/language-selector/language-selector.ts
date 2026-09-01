import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Check, ChevronDown, Globe } from 'lucide-angular';
import { LanguageService } from '../../../core/services/language';

/**
 * THE language switcher.
 *
 * There used to be two, and they did different things. This one wrote through `LanguageService`;
 * the one in the authentication footer called `translate.use()` directly and stored the choice
 * under a key nothing else read, so on the sign-in page — the only place a stranger can change
 * the language — the choice was lost on reload, `<html lang>` never moved, and the service's own
 * signal went stale, after which the route guard's short-circuit meant nothing ever put it back.
 *
 * One component, one code path, two presentations. `variant` decides whether it renders as a
 * settings row or as the compact dropdown the footer needs; both go through the same service.
 *
 * The labels are endonyms — each language is offered in its own language — so this component is
 * the one place in the product where NOT translating the text is the correct behaviour. Somebody
 * looking for their own language must be able to recognise it in a language they cannot read.
 */
@Component({
  selector: 'app-language-selector',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  templateUrl: './language-selector.html',
  styleUrls: ['./language-selector.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageSelector {
  readonly languageService = inject(LanguageService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  /** `settings` renders a labelled row; `compact` renders a dropdown for the auth footer. */
  readonly variant = input<'settings' | 'compact'>('settings');

  readonly icons = { Globe, ChevronDown, Check };
  readonly languages = this.languageService.availableLanguages;

  isOpen = false;

  get currentLabel(): string {
    const current = this.languageService.currentLanguage();
    return this.languages.find((language) => language.code === current)?.label ?? current;
  }

  toggle(event: Event): void {
    event.stopPropagation();
    this.isOpen = !this.isOpen;
  }

  select(code: string): void {
    this.languageService.setLanguage(code);
    this.isOpen = false;
  }

  close(): void {
    this.isOpen = false;
  }

  /**
   * A dropdown that stays open after the reader has looked away is a dropdown that covers the
   * form underneath it. Scoped to this component's own host so two selectors on one page (the
   * footer and a settings panel) do not close each other.
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.isOpen = false;
  }
}
