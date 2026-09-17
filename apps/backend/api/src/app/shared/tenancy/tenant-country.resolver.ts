import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { UnprocessableEntityError } from '../../i18n/localized.exception';

/**
 * Which country a tenant operates in — asked once, answered from one place.
 *
 * ## Why this exists
 *
 * "What country is this tenant in?" was a question several modules answered for themselves, and
 * two of them answered it with a constant:
 *
 *   - `payroll-run.service.ts` read `(input.countryCode ?? 'DO')`, so a run started without an
 *     explicit country was computed under Dominican rules whoever the tenant was;
 *   - HCM never asked at all, and validated every employee's identity document with the Dominican
 *     algorithms;
 *   - customers and suppliers never asked either, and validated nothing.
 *
 * A default of `'DO'` is not a fallback, it is a wrong answer that looks like a right one. The
 * tenant's country decides which tax identifiers are valid, which documents exist, which payroll
 * rules apply and which chart of accounts was provisioned; there is no safe value to assume when
 * it is missing.
 *
 * ## Why it throws instead of defaulting
 *
 * `organizations.country` is nullable because registration did not always set it — the column's
 * own comment records that every tenant once had a null country while its fiscal region said
 * otherwise. Rather than guess, this falls back to the fiscal region (the second source for the
 * same fact) and, if both are empty, refuses. A tenant with no country cannot have its documents
 * validated, its payroll computed or its invoices numbered correctly, and saying so at the point
 * of use is how that gets fixed instead of silently producing Dominican output for a Chilean.
 *
 * ## Caching
 *
 * Per-organization and short-lived. A tenant's country changes essentially never, but it CAN
 * change (a correction during onboarding), and a process-lifetime cache would then serve the old
 * answer until the next deploy.
 */
const CACHE_TTL_MS = 60 * 1000;

@Injectable()
export class TenantCountryResolver {
  private readonly cache = new Map<string, { country: string; at: number }>();

  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
  ) {}

  /**
   * The tenant's ISO 3166-1 alpha-2 country.
   *
   * @throws when neither the organization nor its fiscal region names one.
   */
  async resolve(organizationId: string): Promise<string> {
    const cached = this.cache.get(organizationId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.country;

    const organization = await this.organizations.findOne({
      where: { id: organizationId },
      relations: { fiscalRegion: true },
    });

    const country =
      organization?.country?.trim().toUpperCase() ||
      organization?.fiscalRegion?.countryCode?.trim().toUpperCase() ||
      null;

    if (!country) {
      throw new UnprocessableEntityError('organizations.country_not_set', { organizationId });
    }

    this.cache.set(organizationId, { country, at: Date.now() });
    return country;
  }

  /**
   * The tenant's country, or null when it has none.
   *
   * For callers that have something sensible to do with "unknown" — a list endpoint that should
   * still render, say. A caller that is about to VALIDATE something must use `resolve` and let
   * the error surface: validating against a guessed country is the defect this class replaces.
   */
  async resolveOrNull(organizationId: string): Promise<string | null> {
    try {
      return await this.resolve(organizationId);
    } catch {
      return null;
    }
  }

  /** Drop a tenant's cached country. Called when an organization's country is updated. */
  invalidate(organizationId: string): void {
    this.cache.delete(organizationId);
  }
}
