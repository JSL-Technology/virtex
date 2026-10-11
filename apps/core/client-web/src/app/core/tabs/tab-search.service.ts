import { Injectable, signal } from '@angular/core';

/**
 * The open state of the Chrome-style tab-search panel.
 *
 * ## Why a service rather than component state
 *
 * The trigger and the panel do not live together. The chevron button is rendered by Dockview as a
 * header action — once PER tab group — while the panel is a single overlay, and the keyboard
 * shortcut (⇧⌘A) opens it from nowhere in particular. A shared signal is what lets any of those
 * three open the one panel, and lets the panel anchor itself next to whichever button was clicked
 * (or fall back to the top-left when the keyboard opened it).
 */
@Injectable({ providedIn: 'root' })
export class TabSearchService {
  readonly isOpen = signal(false);

  /** The button the panel should anchor to; null when opened by keyboard. */
  readonly anchor = signal<HTMLElement | null>(null);

  open(anchor: HTMLElement | null = null): void {
    this.anchor.set(anchor);
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
    this.anchor.set(null);
  }

  toggle(anchor: HTMLElement | null = null): void {
    if (this.isOpen()) this.close();
    else this.open(anchor);
  }
}
