import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { UserNavigationFavorite } from './user-navigation-favorite.entity';
import { BadRequestError } from '../../i18n/localized.exception';

/** How many favourites a person may keep in one company. The client enforces the same number. */
export const MAX_FAVORITES = 50;

/**
 * The menu routes a person marked as favourites, per company.
 *
 * Every method takes the user and the company from the caller's principal, never from the request
 * body, and every read and write names both: there is no way to reach someone else's favourites,
 * nor this person's in another company. Every method answers with the whole ordered list, which is
 * what lets the client converge on what is stored after an optimistic change.
 *
 * Writes for one person in one company are serialised with a transaction-scoped advisory lock.
 * Without it two devices adding at once could both pass the limit check, or both take the same
 * next position; with it each write sees the previous one's result.
 */
@Injectable()
export class UserNavigationFavoritesService {
  constructor(
    @InjectRepository(UserNavigationFavorite)
    private readonly repository: Repository<UserNavigationFavorite>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async list(userId: string, organizationId: string): Promise<string[]> {
    return this.read(this.repository.manager, userId, organizationId);
  }

  /** Add a favourite at the end. Adding one that already exists changes nothing. */
  async add(userId: string, organizationId: string, route: string): Promise<string[]> {
    return this.locked(userId, organizationId, async (manager) => {
      const current = await this.read(manager, userId, organizationId);
      if (current.includes(route)) return current;
      if (current.length >= MAX_FAVORITES) {
        throw new BadRequestError('shell.favorites.limit', { max: MAX_FAVORITES }, 'FAVORITES_LIMIT');
      }
      await manager.query(
        `INSERT INTO "user_navigation_favorites" ("organization_id", "user_id", "route", "position")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("organization_id", "user_id", "route") DO NOTHING`,
        [organizationId, userId, route, current.length],
      );
      return this.read(manager, userId, organizationId);
    });
  }

  /** Remove a favourite. Removing one that is not there changes nothing. */
  async remove(userId: string, organizationId: string, route: string): Promise<string[]> {
    return this.locked(userId, organizationId, async (manager) => {
      await manager.delete(UserNavigationFavorite, { organizationId, userId, route });
      const remaining = await this.read(manager, userId, organizationId);
      await this.renumber(manager, userId, organizationId, remaining);
      return remaining;
    });
  }

  /**
   * Put the favourites in the order given.
   *
   * The order comes from a client that may be behind: it can name a route another device already
   * removed, or leave out one another device just added. Names that are not favourites are ignored
   * and favourites it does not name keep their relative order after the ones it does — so a stale
   * reorder can neither resurrect a removal nor lose an addition.
   */
  async reorder(userId: string, organizationId: string, routes: string[]): Promise<string[]> {
    return this.locked(userId, organizationId, async (manager) => {
      const current = await this.read(manager, userId, organizationId);
      const named = [...new Set(routes)].filter((route) => current.includes(route));
      const next = [...named, ...current.filter((route) => !named.includes(route))];
      await this.renumber(manager, userId, organizationId, next);
      return next;
    });
  }

  private async read(manager: EntityManager, userId: string, organizationId: string): Promise<string[]> {
    const rows = await manager.find(UserNavigationFavorite, {
      where: { organizationId, userId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((row) => row.route);
  }

  private async renumber(
    manager: EntityManager,
    userId: string,
    organizationId: string,
    ordered: string[],
  ): Promise<void> {
    if (ordered.length === 0) return;
    // One statement for the whole list: its routes and their new positions travel as two arrays.
    await manager.query(
      `UPDATE "user_navigation_favorites" AS f
          SET "position" = o.position - 1
         FROM unnest($3::varchar[]) WITH ORDINALITY AS o(route, position)
        WHERE f."organization_id" = $1 AND f."user_id" = $2 AND f."route" = o.route`,
      [organizationId, userId, ordered],
    );
  }

  private locked<T>(
    userId: string,
    organizationId: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `navigation-favorites:${organizationId}:${userId}`,
      ]);
      return work(manager);
    });
  }
}
