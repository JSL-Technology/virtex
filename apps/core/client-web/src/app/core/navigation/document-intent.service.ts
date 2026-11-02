import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subject, filter } from 'rxjs';
import { pathWithoutOrganization } from '../tenancy/active-organization.service';
import { NavigationActionsService } from './navigation-actions.service';

/**
 * «Do this to that document», asked from somewhere else — a list row's context menu — and carried
 * out by the document itself.
 *
 * A row's menu offers what the item allows (void, register a payment, approve, credit…), and most
 * of those need what only the document's own screen has: a reason, an amount, a confirmation, a
 * step-up, the rules about who may. Re-implementing each in every list would give each action two
 * versions that drift. So the list asks; the document opens (or comes to the front, if it is open)
 * and runs the same method its own button runs — the same dialog, checks and messages.
 *
 * An intent lives in memory only: it is a click, not a state, and must not run again after a reload.
 */
@Injectable({ providedIn: 'root' })
export class DocumentIntentService {
  private readonly navigation = inject(NavigationActionsService);
  private readonly pending = new Map<string, string>();
  private readonly requests = new Subject<string>();

  /** Open the document at `path` (with or without the company prefix) and ask it to start `action`. */
  request(path: string, action: string): void {
    const key = keyOf(path);
    this.pending.set(key, action);
    this.requests.next(key);
    this.navigation.open(path, 'preview');
  }

  /** The actions asked of the document at `path`: one already waiting, then any asked later. */
  watch(path: string): Observable<string> {
    const key = keyOf(path);
    return new Observable<string>((subscriber) => {
      const take = () => {
        const action = this.pending.get(key);
        if (action === undefined) return;
        this.pending.delete(key);
        subscriber.next(action);
      };
      take();
      const subscription = this.requests.pipe(filter((requested) => requested === key)).subscribe(take);
      return () => subscription.unsubscribe();
    });
  }
}

function keyOf(path: string): string {
  return pathWithoutOrganization(path).split('?')[0].replace(/\/+$/, '');
}

/**
 * Wire a document page to the intents asked of it. Call in an injection context (a field
 * initialiser or the constructor).
 *
 * The action waits until `ready()` — the document has loaded — and runs once, through `actions`,
 * which map an intent to the page's own method. An action the page does not offer is ignored.
 */
export function handleDocumentIntents(options: {
  route: () => string | null | undefined;
  ready: () => boolean;
  actions: Record<string, () => unknown>;
}): void {
  const intents = inject(DocumentIntentService);
  const destroyRef = inject(DestroyRef);
  const queued = signal<string[]>([]);
  let watched: string | null = null;
  let subscription: { unsubscribe(): void } | null = null;

  effect(() => {
    const route = options.route();
    if (!route || route === watched) return;
    watched = route;
    subscription?.unsubscribe();
    subscription = intents.watch(route).subscribe((action) => queued.update((list) => [...list, action]));
  });

  effect(() => {
    const list = queued();
    if (!list.length || !options.ready()) return;
    untracked(() => {
      queued.set([]);
      for (const action of list) void options.actions[action]?.();
    });
  });

  destroyRef.onDestroy(() => subscription?.unsubscribe());
}
