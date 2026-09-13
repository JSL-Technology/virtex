import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DEFAULT_LANGUAGE, LanguageCode } from '@virteex/shared/types';
import { I18nService } from '../i18n/i18n.service';
import { Organization } from '../organizations/entities/organization.entity';

/**
 * The narrative on a system-generated journal entry, in the language the books are kept in.
 *
 * ## What this replaces
 *
 * Thirty-six template literals in Spanish, scattered across every service that posts:
 * `Recibo de cobro REC-2026-000004`, `Ajuste de inventario: …`, `Nómina Septiembre`. A tenant in
 * the United States, invoicing in English, reading an English interface, opened its general ledger
 * and found its own accounting narrated in a language nobody at the company reads.
 *
 * ## Why the ORGANIZATION's language and not the reader's
 *
 * Because a ledger entry's narrative is part of the record, not part of the rendering. It is
 * written once, at posting time, and an auditor asking for the books in six years expects to read
 * what was written then — not a re-translation into whoever happens to be logged in. That is the
 * distinction `LanguageAxis.Books` already draws for account names and fiscal document types, and
 * `Organization.booksLanguage` is the field that carries it.
 *
 * The consequence is deliberate: entries posted before this existed stay in Spanish, which is
 * correct for the Dominican tenants that produced them. Nothing is rewritten.
 */
@Injectable()
export class LedgerNarrativeService {
  /**
   * Books language per organization, for the life of the process.
   *
   * It is fixed at provisioning and never changes — changing it would make the same book read in
   * two languages — so a cache with no invalidation is the honest implementation rather than a
   * shortcut. A posting-heavy request would otherwise re-read the same row per entry.
   */
  private readonly languages = new Map<string, LanguageCode>();

  constructor(private readonly i18n: I18nService) {}

  /**
   * One narrative line, translated into the tenant's books language.
   *
   * `manager` so the read joins the caller's transaction: a tenant created moments ago inside the
   * same transaction is not visible outside it, and provisioning posts its opening entries there.
   */
  async describe(
    manager: EntityManager,
    organizationId: string,
    key: string,
    params: Record<string, unknown> = {},
  ): Promise<string> {
    const language = await this.languageOf(manager, organizationId);
    return this.i18n.translate(key, language, params);
  }

  /**
   * Several narratives at once, sharing the one language lookup.
   *
   * A posting writes a header and one line per account, and each of those carries its own
   * sentence. Resolving them together keeps that to a single read.
   */
  async describeAll<K extends string>(
    manager: EntityManager,
    organizationId: string,
    entries: Record<K, { key: string; params?: Record<string, unknown> }>,
  ): Promise<Record<K, string>> {
    const language = await this.languageOf(manager, organizationId);
    const out = {} as Record<K, string>;
    for (const [name, spec] of Object.entries(entries) as [K, { key: string; params?: Record<string, unknown> }][]) {
      out[name] = this.i18n.translate(spec.key, language, spec.params ?? {});
    }
    return out;
  }

  private async languageOf(
    manager: EntityManager,
    organizationId: string,
  ): Promise<LanguageCode> {
    const cached = this.languages.get(organizationId);
    if (cached) return cached;

    const organization = await manager.findOne(Organization, {
      where: { id: organizationId },
      select: ['id', 'booksLanguage'],
    });
    const language = organization?.booksLanguage ?? DEFAULT_LANGUAGE;
    this.languages.set(organizationId, language);
    return language;
  }
}
