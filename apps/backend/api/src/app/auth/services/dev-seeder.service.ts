import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { User } from '../../users/entities/user.entity/user.entity';
import { RegistrationService } from './registration.service';
import { isDevLikeEnvironment } from '../auth.config';

/**
 * Seeds a ready-to-use administrator for local development so a login exists without registering
 * one by hand on every fresh database.
 *
 * Three rules keep this from being a backdoor, and together they are the whole safety of the
 * feature — a seeded account with a known password reaching a real deployment is a textbook
 * critical vulnerability (CWE-798):
 *
 *  1. It runs only where `isDevLikeEnvironment()` is true — the project's ALLOW-list. The previous
 *     guard was `NODE_ENV === 'production'`, a deny-list that admitted every other value including
 *     an unset one, which the configuration schema then resolved to `development`.
 *  2. It is opt-in, affirmatively: `DEV_SEED=true` in `main.ts`. The default is to create nothing.
 *  3. The password is never a literal in this file. It is taken from `DEV_SEED_PASSWORD` or
 *     generated per boot and printed once.
 *
 * It is also idempotent (skips if the user exists) and resilient (never throws into application
 * boot).
 *
 * It reuses {@link RegistrationService.provisionTenantDirect} — the same `materializeAccount` the
 * paid signup uses — so the seeded tenant is a real one (organization, administrator role, chart of
 * accounts), not a hand-assembled shell that would drift from how tenants are actually created.
 */
@Injectable()
export class DevSeederService {
  private readonly logger = new Logger(DevSeederService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registration: RegistrationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * A password nobody knows in advance, and that the product's own policy would accept.
   *
   * The literal that used to be here — `dev12345` — was a credential committed to the repository
   * (CWE-798), eight characters long, and therefore also BELOW the twelve-character minimum this
   * same product publishes at `GET /auth/password-policy`. The one code path that created an
   * administrator was the one path that did not honour the password rules.
   *
   * 32 bytes of base64url guarantee the length and the lower/upper/digit mix that
   * `PASSWORD_POLICY_REGEX` asks for; the suffix guarantees it deterministically rather than by
   * luck, so a seed can never fail validation on an unlucky draw.
   */
  private generatePassword(): string {
    return `${randomBytes(24).toString('base64url')}Aa1!`;
  }

  async seed(): Promise<void> {
    // The project's allow-list, not `NODE_ENV !== 'production'`. Defence in depth behind the same
    // gate in main.ts: a seeded administrator must be impossible to create outside development
    // even if the caller's gate is ever removed or weakened.
    if (!isDevLikeEnvironment()) {
      this.logger.warn(
        { event: 'dev_seed_refused', nodeEnv: process.env['NODE_ENV'] ?? '<unset>' },
        'Refusing to seed a development user outside development/test.',
      );
      return;
    }

    const email = this.config.get<string>('DEV_SEED_EMAIL') || 'dev@virtex.local';
    // Configured or generated — never a literal from the source. When it is generated it is
    // printed once below, because a password nobody can read is a login nobody can use.
    const configuredPassword = this.config.get<string>('DEV_SEED_PASSWORD');
    const password = configuredPassword || this.generatePassword();
    const passwordIsGenerated = !configuredPassword;
    const organizationName = this.config.get<string>('DEV_SEED_ORG') || 'Virtex Dev';
    const countryCode = this.config.get<string>('DEV_SEED_COUNTRY') || 'DO';

    /** Say the password only when we generated it, and say it exactly once. */
    const announce = (detail: string) =>
      this.logger.warn(
        passwordIsGenerated
          ? `${detail} — password: ${password} (generated for this boot; DEVELOPMENT ONLY)`
          : `${detail} — password: the configured DEV_SEED_PASSWORD (DEVELOPMENT ONLY)`,
      );

    const existing = await this.dataSource.getRepository(User).findOne({
      where: { email },
      relations: ['organization'],
    });
    if (existing) {
      // "Already present" is not the same as "usable". If a previous boot hit the minimal
      // fallback below, the account exists with an organization that has no fiscal region, and
      // therefore no chart of accounts, no taxes, no ledger, no journals and no open periods.
      // Returning here left that tenant broken forever, because this branch is the only thing
      // that ever runs again. Repairing is idempotent: a tenant that already has its region is
      // left untouched.
      await this.repairIfUnprovisioned(existing, countryCode);
      return;
    }

    try {
      await this.registration.provisionTenantDirect({
        email,
        password,
        firstName: 'Dev',
        lastName: 'User',
        organizationName,
        countryCode,
        taxpayerKind: 'company',
      });
      announce(`Seeded DEV admin ${email} in org "${organizationName}" (${countryCode})`);
    } catch (err) {
      // Full provisioning (chart of accounts, taxes) can fail on an incomplete local database.
      // Fall back to a minimal tenant (no country → provisioning skipped) so a login still exists.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Dev seed with provisioning failed (${message}); retrying minimal.`);
      try {
        await this.registration.provisionTenantDirect({
          email,
          password,
          firstName: 'Dev',
          lastName: 'User',
          organizationName,
          countryCode: null,
        });
        announce(`Seeded MINIMAL dev admin ${email} (no chart of accounts)`);
      } catch (err2) {
        const message2 = err2 instanceof Error ? err2.message : String(err2);
        this.logger.error(`Dev seed failed; no dev user created: ${message2}`);
      }
    }
  }

  /**
   * Finish provisioning a dev tenant that a previous boot left without its fiscal package.
   *
   * Never throws into boot: a repair that fails leaves exactly what was there before, and the
   * message says so, rather than taking the application down over a development convenience.
   */
  private async repairIfUnprovisioned(user: User, countryCode: string): Promise<void> {
    const organizationId = user.organizationId ?? user.organization?.id ?? null;
    if (!organizationId) {
      this.logger.log(`Dev user already present: ${user.email} (login ready).`);
      return;
    }

    if (user.organization?.fiscalRegionId && user.organization?.subscriptionStatus) {
      this.logger.log(`Dev user already present: ${user.email} (login ready).`);
      return;
    }

    try {
      const repaired = await this.registration.provisionExistingTenant({
        organizationId,
        countryCode,
        taxpayerKind: 'company',
      });
      const fixed = [
        repaired.books
          ? `fiscal package for ${countryCode} (chart of accounts, taxes, ledger, journals, periods)`
          : null,
        repaired.entitlement ? 'an active subscription' : null,
      ].filter(Boolean);

      if (fixed.length) {
        this.logger.warn(`Dev tenant for ${user.email} was missing ${fixed.join(' and ')}; provisioned it.`);
      } else {
        this.logger.log(`Dev user already present: ${user.email} (login ready).`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Dev tenant repair failed for ${user.email} (${message}); the login works but the tenant is still incompletely provisioned.`,
      );
    }
  }
}
