import { ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, ChevronDown } from 'lucide-angular';
import { TabSearchService } from '../tab-search.service';

/**
 * The chevron at the far left of the tab strip that opens the tab-search panel — Chrome's
 * "Search tabs" control.
 *
 * Rendered by Dockview as the strip's PREFIX header action (before the first tab), so it is per
 * group. It owns no panel: it only toggles the shared {@link TabSearchService}, passing its own
 * element as the anchor so the single panel opens next to whichever strip was clicked.
 */
@Component({
  selector: 'app-tab-search-button',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="tsb"
      [class.is-open]="tabSearch.isOpen()"
      [title]="'main.shortcuts.search_tabs' | translate"
      [attr.aria-label]="'main.shortcuts.search_tabs' | translate"
      [attr.aria-expanded]="tabSearch.isOpen()"
      aria-haspopup="dialog"
      (click)="toggle()"
    >
      <lucide-icon [img]="ChevronDownIcon" size="16" aria-hidden="true" />
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        height: 100%;
        padding: 0 2px 0 4px;
      }
      .tsb {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border: 0;
        border-radius: var(--radius-md);
        background: transparent;
        color: var(--content-tertiary);
        cursor: pointer;
        transition: background-color 0.12s ease, color 0.12s ease;
      }
      .tsb:hover {
        background: var(--surface-hover);
        color: var(--content-primary);
      }
      .tsb.is-open {
        background: var(--accent-surface);
        color: var(--accent-text);
      }
    `,
  ],
})
export class TabSearchButtonComponent {
  protected readonly tabSearch = inject(TabSearchService);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly ChevronDownIcon = ChevronDown;

  protected toggle(): void {
    this.tabSearch.toggle(this.el.nativeElement);
  }
}
