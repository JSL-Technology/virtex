import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth';
import { NotificationService } from '../services/notification';
import { ActiveModuleService, Destination, normalizeRoute } from '../modules/active-module.service';

/** What the server answers to every favourites request: the whole list, in order. */
interface FavoritesResponse {
  routes: string[];
}

/** How many favourites a person may keep. The same number the server enforces. */
export const MAX_FAVORITES = 50;

/**
 * The menu destinations a person marked as favourites, in the order they chose.
 *
 * ## Where they live
 *
 * On the server, per person and company — like the workspace — so a favourite set at the office is
 * there at home. A copy is kept in `localStorage` so the panel draws them at once on start-up,
 * without waiting for a request, and so they survive a server that does not answer.
 *
 * ## Why every change is optimistic, and how it stays honest
 *
 * Starring an entry must feel instant: the star fills, the entry appears under Favourites, and the
 * request happens behind it. Two things keep that from lying:
 *
 *  - writes go out ONE AT A TIME, in the order they were made. Adding and removing the same entry
 *    quickly could otherwise reach the server in the opposite order and leave the opposite result.
 *  - the server always answers with the whole list, and that answer is adopted once nothing else
 *    is queued — so the screen converges on what is stored. A write that fails says so and reloads
 *    the list from the server instead of leaving a star that was never saved.
 *
 * ## What a favourite is
 *
 * A route of the menu (`/accounting/journals`), never a document. Only routes this seat may open
 * are shown, resolved against the same permission-filtered menu the panel renders; one that stops
 * being available — a role changed, a module was switched off — is hidden, not deleted, and comes
 * back if access does.
 */
@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly modules = inject(ActiveModuleService);

  private static readonly URL = `${environment.apiUrl}/me/favorites`;

  /** The stored order, including routes this seat cannot currently open. */
  private readonly routes = signal<string[]>([]);

  /** Whose favourites these are: `user:organization`, or null when nobody is signed in. */
  private owner: string | null = null;

  /** Bumped whenever the owner changes, so a late answer for the previous company is dropped. */
  private generation = 0;

  /** Writes not yet answered. The server's list is only adopted when this is zero. */
  private pending = 0;
  private queue: Promise<unknown> = Promise.resolve();

  /** The favourites to show: in order, and only those this seat may open. */
  readonly items = computed<Destination[]>(() => {
    const index = this.modules.destinations();
    return this.routes()
      .map((route) => index.get(route))
      .filter((destination): destination is Destination => destination !== undefined);
  });

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      const owner = user?.id && user.organizationId ? `${user.id}:${user.organizationId}` : null;
      untracked(() => this.switchOwner(owner));
    });
  }

  /** Is this route a menu destination this seat may open — i.e. could it be a favourite? */
  canFavorite(route: string): boolean {
    return this.modules.destinations().has(normalizeRoute(route));
  }

  isFavorite(route: string): boolean {
    return this.routes().includes(normalizeRoute(route));
  }

  toggle(route: string): void {
    if (this.isFavorite(route)) this.remove(route);
    else this.add(route);
  }

  add(route: string): void {
    const target = normalizeRoute(route);
    if (!this.canFavorite(target) || this.isFavorite(target)) return;
    if (this.routes().length >= MAX_FAVORITES) {
      this.notify.showWarning('shell.favorites.limit', { max: MAX_FAVORITES });
      return;
    }
    this.apply([...this.routes(), target]);
    this.write(() => this.http.post<FavoritesResponse>(FavoritesService.URL, { route: target }));
  }

  /**
   * Remove a favourite. Removing is one click on a star that sits right next to the entry, so it
   * is easy to do by accident: the confirmation offers to undo it rather than asking first.
   */
  remove(route: string, options: { undoable?: boolean } = { undoable: true }): void {
    const target = normalizeRoute(route);
    const before = this.routes();
    const index = before.indexOf(target);
    if (index === -1) return;
    this.apply(before.filter((r) => r !== target));
    this.write(() =>
      this.http.delete<FavoritesResponse>(FavoritesService.URL, { params: { route: target } }),
    );
    if (options.undoable) {
      this.notify.showInfo('shell.favorites.removed', undefined, {
        labelKey: 'shell.favorites.undo',
        handler: () => this.restore(target, index),
      });
    }
  }

  /** Move a favourite up (-1) or down (+1). Out-of-range moves do nothing. */
  move(route: string, delta: -1 | 1): void {
    const visible = this.items().map((item) => item.route);
    const from = visible.indexOf(normalizeRoute(route));
    const to = from + delta;
    if (from === -1 || to < 0 || to >= visible.length) return;

    // Reorder what the person sees, and keep hidden favourites where they were relative to it.
    [visible[from], visible[to]] = [visible[to], visible[from]];
    const hidden = this.routes().filter((r) => !visible.includes(r));
    const next = [...visible, ...hidden];
    this.apply(next);
    this.write(() =>
      this.http.put<FavoritesResponse>(`${FavoritesService.URL}/order`, { routes: next }),
    );
  }

  /** Put back a favourite removed by mistake, where it was. */
  private restore(route: string, index: number): void {
    if (this.isFavorite(route)) return;
    const next = [...this.routes()];
    next.splice(Math.min(index, next.length), 0, route);
    this.apply(next);
    this.write(async () => {
      await firstValueFrom(this.http.post<FavoritesResponse>(FavoritesService.URL, { route }));
      return this.http.put<FavoritesResponse>(`${FavoritesService.URL}/order`, { routes: next });
    });
  }

  // ── sincronización ──────────────────────────────────────────────────────

  private switchOwner(owner: string | null): void {
    if (owner === this.owner) return;
    this.owner = owner;
    this.generation++;
    this.pending = 0;
    this.queue = Promise.resolve();
    this.routes.set(owner ? this.readCache(owner) : []);
    if (owner) void this.pull(this.generation);
  }

  private async pull(generation: number): Promise<void> {
    try {
      const response = await firstValueFrom(this.http.get<FavoritesResponse>(FavoritesService.URL));
      if (generation === this.generation && this.pending === 0) this.adopt(response);
    } catch (error) {
      // The cached copy keeps showing; the next change retries the server.
      console.info('[favorites] no se pudieron leer los favoritos del servidor', error);
    }
  }

  /**
   * Queue a write behind the previous ones. `request` may return an observable or a promise of
   * one, for a write that takes two calls (undo: add, then reorder).
   */
  private write(
    request: () => ReturnType<HttpClient['post']> | Promise<ReturnType<HttpClient['post']>>,
  ): void {
    const generation = this.generation;
    this.pending++;
    this.queue = this.queue.then(async () => {
      if (generation !== this.generation) return;
      try {
        const response = (await firstValueFrom(await request())) as FavoritesResponse;
        if (generation !== this.generation) return;
        this.pending--;
        if (this.pending === 0) this.adopt(response);
      } catch (error) {
        if (generation !== this.generation) return;
        this.pending--;
        this.notify.showHttpError(error, 'shell.favorites.save_failed');
        if (this.pending === 0) await this.pull(generation);
      }
    });
  }

  private adopt(response: FavoritesResponse | null | undefined): void {
    if (!response || !Array.isArray(response.routes)) return;
    this.apply(response.routes.map(normalizeRoute));
  }

  private apply(routes: string[]): void {
    this.routes.set(routes);
    if (this.owner) this.writeCache(this.owner, routes);
  }

  private readCache(owner: string): string[] {
    try {
      const raw = localStorage.getItem(cacheKey(owner));
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : [];
    } catch {
      return [];
    }
  }

  private writeCache(owner: string, routes: string[]): void {
    try {
      localStorage.setItem(cacheKey(owner), JSON.stringify(routes));
    } catch {
      // Storage blocked: the server copy is the one that matters.
    }
  }
}

function cacheKey(owner: string): string {
  return `virtex.nav.favorites.${owner}`;
}
