import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { LucideAngularModule, Search, ScanLine, RefreshCw, PackageOpen } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { CatalogueItem } from '../../../core/pos-api.service';
import { ToastService } from '../../../core/toast.service';
import { filterCatalogue, isOutOfStock } from '../../../domain/cart';
import { TillStore } from '../../../state/till.store';

/** Below this many units a good is flagged as running low on its tile. */
const LOW_STOCK = 5;

/**
 * The catalogue: search by name, SKU or barcode; scan; filter by category; tap to add.
 *
 * A handheld scanner is a keyboard that types the code and Enter. Enter in the search box adds the
 * exact barcode/SKU match and clears the box, ready for the next scan; when nothing matches
 * exactly and the search leaves a single product, Enter adds that one instead.
 */
@Component({
  selector: 'pos-catalog-panel',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toolbar">
      <label class="search">
        <lucide-icon [img]="SearchIcon" size="18" aria-hidden="true" />
        <span class="sr-only">{{ 'pos.search_products' | translate }}</span>
        <input
          #search
          type="search"
          autocomplete="off"
          enterkeyhint="go"
          [placeholder]="'pos.search_products' | translate"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
          (keydown.enter)="onEnter()"
          data-testid="pos-search"
        />
        <kbd aria-hidden="true">F2</kbd>
      </label>
      <button type="button" class="icon-btn" (click)="till.loadCatalogue()" [attr.aria-label]="'pos.reload_catalogue' | translate" [title]="'pos.reload_catalogue' | translate">
        <lucide-icon [img]="RefreshIcon" size="18" aria-hidden="true" [class.spin]="till.catalogueLoading()" />
      </button>
    </div>

    @if (till.categories().length > 0) {
      <div class="chips" role="radiogroup" [attr.aria-label]="'pos.categories' | translate">
        <button type="button" role="radio" class="chip" [class.active]="!category()" [attr.aria-checked]="!category()" (click)="category.set(null)">
          {{ 'pos.all_categories' | translate }}
        </button>
        @for (cat of till.categories(); track cat.id) {
          <button type="button" role="radio" class="chip" [class.active]="category() === cat.id" [attr.aria-checked]="category() === cat.id" (click)="category.set(cat.id)">
            {{ cat.name }}
          </button>
        }
      </div>
    }

    <div class="grid-wrap">
      @if (till.catalogueLoading() && till.catalogue().length === 0) {
        <div class="grid" aria-busy="true">
          @for (i of skeleton; track i) {
            <div class="tile tile--skeleton"></div>
          }
        </div>
      } @else if (till.catalogueError() && till.catalogue().length === 0) {
        <div class="empty">
          <p>{{ 'pos.load_products_error' | translate }}</p>
          <button type="button" class="btn" (click)="till.loadCatalogue()">{{ 'pos.shift_retry' | translate }}</button>
        </div>
      } @else {
        <div class="grid" data-testid="pos-catalog">
          @for (item of visible(); track item.id) {
            <button
              type="button"
              class="tile"
              [class.tile--out]="isOut(item)"
              [disabled]="isOut(item)"
              (click)="add(item)"
              [attr.aria-label]="'pos.add_item_aria' | translate: { name: item.name, price: (item.price | vxMoney: till.currency()) }"
            >
              <div class="tile__media">
                @if (item.imageUrl && !broken().has(item.id)) {
                  <img [src]="item.imageUrl" alt="" loading="lazy" (error)="markBroken(item.id)" />
                } @else {
                  <!-- Sin imagen, o una que no carga: las iniciales, nunca el icono de imagen rota. -->
                  <span class="initials" aria-hidden="true">{{ initials(item.name) }}</span>
                }
                @if (isOut(item)) {
                  <span class="badge badge--out">{{ 'pos.out_of_stock' | translate }}</span>
                } @else if (item.kind === 'GOOD' && item.stock <= lowStock) {
                  <span class="badge badge--low">{{ 'pos.in_stock' | translate: { count: item.stock } }}</span>
                }
              </div>
              <div class="tile__body">
                <span class="tile__name">{{ item.name }}</span>
                @if (item.sku) {
                  <span class="tile__sku">{{ item.sku }}</span>
                }
                <span class="tile__price num">{{ item.price | vxMoney: till.currency() }}</span>
              </div>
            </button>
          } @empty {
            <div class="empty">
              <lucide-icon [img]="EmptyIcon" size="40" aria-hidden="true" />
              <p>{{ (till.catalogue().length ? 'pos.no_matches' : 'pos.no_products') | translate }}</p>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; min-height: 0; gap: 12px; padding: 16px; }
      .toolbar { display: flex; gap: 8px; align-items: center; }
      .search { flex: 1; display: flex; align-items: center; gap: 10px; padding: 0 12px; min-height: 52px; background: var(--pos-surface); border: 1px solid var(--pos-border-strong); border-radius: 14px; color: var(--pos-muted); }
      .search:focus-within { border-color: var(--pos-primary); box-shadow: var(--pos-focus); }
      .search input { flex: 1; background: transparent; border: 0; outline: none; color: var(--pos-text); font-size: 1.05rem; min-width: 0; }
      .search input:focus-visible { box-shadow: none; }
      .chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
      .chip { flex: none; min-height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--pos-border-strong); background: var(--pos-surface); color: var(--pos-muted); font-weight: 600; font-size: 0.88rem; }
      .chip.active { background: color-mix(in srgb, var(--pos-primary) 20%, transparent); border-color: var(--pos-primary); color: var(--pos-text); }
      .grid-wrap { flex: 1; min-height: 0; overflow: auto; margin: 0 -4px; padding: 0 4px 4px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
      .tile { position: relative; display: flex; flex-direction: column; text-align: left; padding: 0; border-radius: 14px; overflow: hidden; border: 1px solid var(--pos-border); background: var(--pos-surface); transition: border-color 0.12s, transform 0.08s, box-shadow 0.12s; }
      .tile:hover:not(:disabled) { border-color: var(--pos-primary); box-shadow: 0 6px 18px rgb(0 0 0 / 0.3); }
      .tile:active:not(:disabled) { transform: scale(0.98); }
      .tile--out { opacity: 0.55; }
      .tile--skeleton { height: 196px; background: linear-gradient(90deg, var(--pos-surface) 0%, var(--pos-surface-2) 50%, var(--pos-surface) 100%); background-size: 200% 100%; animation: shimmer 1.2s infinite; }
      .tile__media { position: relative; aspect-ratio: 4 / 3; background: var(--pos-surface-2); display: grid; place-items: center; }
      .tile__media img { width: 100%; height: 100%; object-fit: cover; }
      .initials { font-size: 1.7rem; font-weight: 700; color: var(--pos-muted); letter-spacing: 1px; }
      .badge { position: absolute; top: 8px; left: 8px; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; }
      .badge--out { background: var(--pos-danger); color: #fff; }
      .badge--low { background: var(--pos-warning); color: #2a1a00; }
      .tile__body { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px 12px; }
      .tile__name { font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.5em; }
      .tile__sku { color: var(--pos-faint); font-size: 0.75rem; }
      .tile__price { margin-top: 4px; font-size: 1.05rem; font-weight: 700; color: var(--pos-text); }
      .empty { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 16px; color: var(--pos-muted); text-align: center; }
      .spin { animation: spin 0.9s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes shimmer { to { background-position: -200% 0; } }
    `,
  ],
})
export class CatalogPanelComponent {
  protected readonly till = inject(TillStore);
  private readonly toast = inject(ToastService);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly SearchIcon = Search;
  protected readonly ScanIcon = ScanLine;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly EmptyIcon = PackageOpen;
  protected readonly lowStock = LOW_STOCK;
  protected readonly skeleton = Array.from({ length: 12 }, (_, i) => i);

  readonly query = signal('');
  readonly category = signal<string | null>(null);
  /** Products whose picture failed to load: they show their initials instead of a broken image. */
  protected readonly broken = signal<ReadonlySet<string>>(new Set());

  protected readonly visible = computed(() => filterCatalogue(this.till.catalogue(), this.query(), this.category()));

  focusSearch(): void {
    const input = this.searchInput()?.nativeElement;
    input?.focus();
    input?.select();
  }

  protected isOut(item: CatalogueItem): boolean {
    return isOutOfStock(item);
  }

  protected add(item: CatalogueItem): void {
    this.till.add(item);
  }

  protected onEnter(): void {
    const term = this.query().trim();
    if (!term) return;
    if (this.till.addByCode(term)) {
      this.query.set('');
      return;
    }
    const matches = this.visible();
    if (matches.length === 1) {
      if (this.till.add(matches[0])) this.query.set('');
      return;
    }
    if (matches.length === 0) this.toast.warning('pos.code_not_found', { code: term });
  }

  protected markBroken(id: string): void {
    this.broken.update((current) => new Set([...current, id]));
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toLocaleUpperCase() ?? '')
      .join('');
  }
}
