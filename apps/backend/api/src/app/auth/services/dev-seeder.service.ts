import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { User } from '../../users/entities/user.entity/user.entity';
import { RegistrationService } from './registration.service';

/**
 * Seeds a ready-to-use administrator for local development so a login exists without registering
 * one by hand on every fresh database.
 *
 * The one rule that keeps this from being a backdoor: it **refuses to run in production**. A seeded
 * account with a known password reaching a real deployment is a textbook critical vulnerability
 * (CWE-798), so the guard here is not a convenience — it is the whole safety of the feature. It is
 * also idempotent (skips if the user exists) and resilient (never throws into application boot).
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

  async seed(): Promise<void> {
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    if (nodeEnv === 'production') {
      // Defence in depth: the caller in main.ts already gates on this, but a seeded admin must be
      // impossible to create in production even if that guard is ever removed.
      this.logger.warn('Refusing to seed a development user in production.');
      return;
    }

    const email = this.config.get<string>('DEV_SEED_EMAIL') || 'dev@virtex.local';
    const password = this.config.get<string>('DEV_SEED_PASSWORD') || 'dev12345';
    const organizationName = this.config.get<string>('DEV_SEED_ORG') || 'Virtex Dev';
    const countryCode = this.config.get<string>('DEV_SEED_COUNTRY') || 'DO';

    const existing = await this.dataSource.getRepository(User).findOne({ where: { email } });
    if (existing) {
      this.logger.log(`Dev user already present: ${email} (login ready).`);
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
      this.logger.warn(
        `Seeded DEV admin — ${email} / ${password} — org "${organizationName}" (${countryCode}). DEVELOPMENT ONLY.`,
      );
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
        this.logger.warn(
          `Seeded MINIMAL dev admin — ${email} / ${password} (no chart of accounts). DEVELOPMENT ONLY.`,
        );
      } catch (err2) {
        const message2 = err2 instanceof Error ? err2.message : String(err2);
        this.logger.error(`Dev seed failed; no dev user created: ${message2}`);
      }
    }
  }
}
