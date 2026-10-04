import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TAB_CONTEXT } from '../tabs/tab-context';
import { TabStateService } from '../tabs/tab-state.service';

/** Where the last change to the data came from. */
export type DataChangeSource = 'local' | 'remote';

/**
 * How current the data on screen is (QA M-06).
 *
 * Every successful write the client makes bumps a version (see `dataVersionInterceptor`), and the
 * version is shared with the other windows of the same session — a popped-out tab is another
 * window. A screen remembers the version it last loaded at; when it comes back into view and the
 * version moved, what it shows may be stale. That is all this knows: not WHICH data changed —
 * a payment touches the invoice, the receipt, the bank and the customer's balance, and a list of
 * dependencies kept by hand is the kind that is wrong by the next release.
 */
@Injectable({ providedIn: 'root' })
export class DataVersionService {
  private readonly versionSignal = signal(0);
  private readonly sourceSignal = signal<DataChangeSource>('local');
  private readonly channel: BroadcastChannel | null =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('virtex:data-version') : null;

  readonly version = this.versionSignal.asReadonly();
  readonly lastSource = this.sourceSignal.asReadonly();

  constructor() {
    this.channel?.addEventListener('message', () => this.advance('remote'));
  }

  /** A write in this window succeeded: tell the others too. */
  changed(): void {
    this.advance('local');
    this.channel?.postMessage('changed');
  }

  private advance(source: DataChangeSource): void {
    this.sourceSignal.set(source);
    this.versionSignal.update((version) => version + 1);
  }
}

/**
 * Reload when the data may have changed while this screen was not looking.
 *
 * Call from a component's injection context with the screen's own reload. It fires when the
 * screen's tab becomes visible again (or the browser window regains focus) after a write
 * elsewhere, and immediately when another window writes while it is on screen. A write made by
 * this screen itself does not fire it: the screen already reloads after its own save, and a second
 * request would only flicker.
 */
export function refreshWhenStale(reload: () => void): void {
  const data = inject(DataVersionService);
  const tab = inject(TAB_CONTEXT, { optional: true });
  const tabs = inject(TabStateService, { optional: true });
  const document = inject(DOCUMENT);
  const destroyRef = inject(DestroyRef);

  const visible = signal(document.visibilityState !== 'hidden');
  const onVisibility = () => visible.set(document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', onVisibility);
  destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onVisibility));

  let seen = untracked(data.version);
  let wasShown = true;

  effect(() => {
    const version = data.version();
    const shown = visible() && (!tab || !tabs || tabs.activeTabId() === tab.tabId);
    untracked(() => {
      const stale = version !== seen;
      const cameBack = shown && !wasShown;
      if (stale && shown && (cameBack || data.lastSource() === 'remote')) reload();
      if (shown) seen = version;
      wasShown = shown;
    });
  });
}
