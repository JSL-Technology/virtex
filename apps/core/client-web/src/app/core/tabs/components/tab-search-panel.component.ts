import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { LucideAngularModule, Search, X, ChevronDown, Clock } from 'lucide-angular';
import { TabStateService } from '../tab-state.service';
import { TabSearchService } from '../tab-search.service';
import { resolveTabIcon } from './tab-icon';
import { LanguageService } from '../../services/language';
import { ShortcutsService } from '../../keyboard/shortcuts.service';
import { VxKbdComponent } from '../../../shared/components/kbd';

/** A flat row in the keyboard-navigable result list, spanning both sections. */
interface ResultRow {
  kind: 'open' | 'closed';
  id: string;
}

/**
 * The tab-search panel — Chrome's "Search tabs", for the workspace's tabs.
 *
 * ## What it does (nothing omitted)
 *
 * - A search box that filters BOTH lists live, by title and by route.
 * - "Open tabs": every open tab with its icon, title, route and when it was last used; the active
 *   one highlighted, a close (×) on each. Clicking one activates it; the × closes it in place.
 * - "Recently closed" (collapsible): tabs you closed, newest first, with when; clicking reopens.
 * - Full keyboard control: ↑/↓ move through both lists, Enter activates/reopens the highlighted
 *   row, Esc closes. The search box keeps focus throughout, so you can keep typing to narrow.
 * - Closes on Escape, on a click outside, or after a choice.
 *
 * It is a single instance (rendered by the tab container) driven by {@link TabSearchService};
 * the trigger button and the ⇧⌘A shortcut both just flip that service's `isOpen`.
 */
@Component({
  selector: 'app-tab-search-panel',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, VxKbdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tab-search-panel.component.html',
  styleUrls: ['./tab-search-panel.component.scss'],
})
export class TabSearchPanelComponent {
  protected readonly tabState = inject(TabStateService);
  protected readonly tabSearch = inject(TabSearchService);
  private readonly lang = inject(LanguageService);
  private readonly shortcuts = inject(ShortcutsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly SearchIcon = Search;
  protected readonly CloseIcon = X;
  protected readonly ChevronIcon = ChevronDown;
  protected readonly ClockIcon = Clock;

  /** The chord bound to "Search tabs", shown as a hint in the box (⇧⌘A). */
  protected readonly searchChord = computed(() => this.shortcuts.primaryChord('tabs.search'));

  protected readonly query = signal('');
  protected readonly closedCollapsed = signal(false);
  /** Highlighted row across both lists, for ↑/↓/Enter. */
  protected readonly activeIndex = signal(0);

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  /** Localised relative-time formatter, rebuilt only when the language changes. */
  private readonly rtf = computed(
    () => new Intl.RelativeTimeFormat(this.lang.currentLocale(), { numeric: 'auto' }),
  );

  protected readonly openResults = computed(() => {
    const q = this.normalizedQuery();
    const tabs = this.tabState.tabs();
    return q ? tabs.filter((t) => this.matches(t.title, t.route, q)) : tabs;
  });

  protected readonly closedResults = computed(() => {
    const q = this.normalizedQuery();
    const closed = this.tabState.recentlyClosed();
    return q ? closed.filter((t) => this.matches(t.title, t.route, q)) : closed;
  });

  /** The two lists flattened in display order, for arrow-key navigation. */
  private readonly flat = computed<ResultRow[]>(() => {
    const open = this.openResults().map<ResultRow>((t) => ({ kind: 'open', id: t.id }));
    const closed = this.closedCollapsed()
      ? []
      : this.closedResults().map<ResultRow>((t) => ({ kind: 'closed', id: t.id }));
    return [...open, ...closed];
  });

  /** `kind:id` of the highlighted row, so the template can mark it without index math. */
  protected readonly activeKey = computed(() => {
    const row = this.flat()[this.activeIndex()];
    return row ? `${row.kind}:${row.id}` : '';
  });

  protected readonly hasAnyResult = computed(
    () => this.openResults().length > 0 || this.closedResults().length > 0,
  );

  constructor() {
    // Focus the box as soon as the panel opens, and keep the highlight in range as lists change.
    effect(() => {
      if (this.tabSearch.isOpen()) this.searchInput()?.nativeElement.focus();
    });
    effect(() => {
      const max = this.flat().length - 1;
      if (this.activeIndex() > max) this.activeIndex.set(Math.max(0, max));
    });
  }

  protected icon(name: string): unknown {
    return resolveTabIcon(name);
  }

  protected relativeTime(date: Date): string {
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 60) return this.rtf().format(seconds, 'second');
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return this.rtf().format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return this.rtf().format(hours, 'hour');
    return this.rtf().format(Math.round(hours / 24), 'day');
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.activeIndex.set(0);
  }

  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.move(-1);
        break;
      case 'Enter':
        event.preventDefault();
        this.activateHighlighted();
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.tabSearch.close();
        break;
    }
  }

  protected toggleClosed(): void {
    this.closedCollapsed.update((v) => !v);
  }

  protected chooseOpen(id: string): void {
    this.tabState.activateTab(id);
    this.tabSearch.close();
  }

  protected closeOpen(id: string, event: MouseEvent): void {
    // Closing a tab from the list must not also pick it, nor dismiss the panel.
    event.stopPropagation();
    void this.tabState.closeTab(id);
    this.searchInput()?.nativeElement.focus();
  }

  protected chooseClosed(id: string): void {
    this.tabState.reopenClosed(id);
    this.tabSearch.close();
  }

  /** A click anywhere outside the panel and its trigger dismisses it. */
  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target as Node;
    if (this.host.nativeElement.contains(target)) return;
    const anchor = this.tabSearch.anchor();
    if (anchor?.contains(target)) return;
    this.tabSearch.close();
  }

  private normalizedQuery(): string {
    return this.query().trim().toLowerCase();
  }

  private matches(title: string, route: string, query: string): boolean {
    return title.toLowerCase().includes(query) || route.toLowerCase().includes(query);
  }

  private move(delta: number): void {
    const length = this.flat().length;
    if (length === 0) return;
    this.activeIndex.update((i) => (i + delta + length) % length);
  }

  private activateHighlighted(): void {
    const row = this.flat()[this.activeIndex()];
    if (!row) return;
    if (row.kind === 'open') this.chooseOpen(row.id);
    else this.chooseClosed(row.id);
  }
}
