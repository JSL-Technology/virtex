import { Injectable, computed, signal } from '@angular/core';

/**
 * The navigation sidebar's width, when the reader has chosen one.
 *
 * ## Why `null` means "don't touch it"
 *
 * The layout already sizes the sidebar responsively in CSS — 240px normally, 208px on a mid-width
 * screen, a drawer below 768px. If this service always wrote a width, it would override those
 * media-query defaults everywhere, and a mid-width screen would get 240 instead of 208. So the
 * width is `null` until the reader actually drags the edge; only then does an explicit px value
 * take over, and a double-click (reset) drops it back to `null` so the responsive CSS resumes. That
 * is the VS Code behaviour: sensible defaults, remembered the moment you override them.
 *
 * ## Persistence and clamping
 *
 * A remembered width is clamped to a sane band before use — a value from a wider monitor, or a
 * corrupt localStorage entry, can never leave the sidebar unusably narrow or eating the content.
 */
@Injectable({ providedIn: 'root' })
export class SidebarResizeService {
  static readonly MIN = 200;
  static readonly MAX = 460;
  /** Matches the CSS `--panel-width` default, for callers that need a number. */
  static readonly DEFAULT = 240;

  private static readonly STORAGE_KEY = 'virtex.sidebar-width.v1';

  /** The chosen width in px, or `null` to follow the responsive CSS defaults. */
  readonly width = signal<number | null>(this.load());

  /** The value to write to `--panel-width`, or `null` to remove the override. */
  readonly widthStyle = computed(() => {
    const width = this.width();
    return width === null ? null : `${width}px`;
  });

  readonly isCustomized = computed(() => this.width() !== null);

  setWidth(px: number): void {
    this.width.set(this.clamp(px));
    this.persist();
  }

  /** Back to the responsive default (what a double-click on the grip does). */
  reset(): void {
    this.width.set(null);
    this.persist();
  }

  private clamp(px: number): number {
    return Math.min(SidebarResizeService.MAX, Math.max(SidebarResizeService.MIN, Math.round(px)));
  }

  private load(): number | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(SidebarResizeService.STORAGE_KEY);
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? this.clamp(value) : null;
    } catch {
      return null;
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const width = this.width();
      if (width === null) localStorage.removeItem(SidebarResizeService.STORAGE_KEY);
      else localStorage.setItem(SidebarResizeService.STORAGE_KEY, String(width));
    } catch {
      /* storage unavailable: the width still works for this session. */
    }
  }
}
