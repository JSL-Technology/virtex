import { DataSource } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { PasswordRecoveryService } from './password-recovery.service';
import { createHash } from 'node:crypto';

/**
 * Redeeming an invitation, against a real Postgres: what was wrong lived in what TypeORM writes.
 *
 *  - The token was "cleared" by assigning `undefined`, which TypeORM leaves out of the UPDATE, so
 *    the hash stayed in the row after it had served its purpose.
 *  - Two concurrent redemptions of the same link could both find the pending row and both set a
 *    password. The token is now consumed by one conditional UPDATE, which exactly one wins.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('invitation redemption', () => {
  jest.setTimeout(120_000);

  let ds: DataSource;
  let org: Organization;
  let service: PasswordRecoveryService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../../**/*.entity.{js,ts}`],
    });
    await ds.initialize();
    org = await ds.getRepository(Organization).save({ legalName: `INV ${Date.now()}` } as Organization);

    const passwordService = {
      assertNotBreached: jest.fn().mockResolvedValue(undefined),
      hash: jest.fn().mockResolvedValue('argon2id$test'),
    };
    service = new PasswordRecoveryService(
      ds.getRepository(User),
      {} as never,
      {} as never,
      passwordService as never,
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  async function invited(rawToken: string): Promise<User> {
    return ds.getRepository(User).save({
      firstName: 'Invitada',
      lastName: 'Prueba',
      email: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
      organizationId: org.id,
      status: UserStatus.PENDING,
      invitationToken: createHash('sha256').update(rawToken).digest('hex'),
      invitationTokenExpires: new Date(Date.now() + 60 * 60 * 1000),
    } as unknown as User);
  }

  it('clears the token in the database once redeemed', async () => {
    const raw = `tok-${Math.random().toString(36).slice(2)}`;
    const user = await invited(raw);

    await service.setPasswordFromInvitation({ token: raw, password: 'Una-clave-larga-1' } as never);

    const [row] = await ds.query(
      `SELECT "invitationToken", "invitationTokenExpires", status FROM users WHERE id = $1`,
      [user.id],
    );
    expect(row.invitationToken).toBeNull();
    expect(row.invitationTokenExpires).toBeNull();
    expect(row.status).toBe(UserStatus.ACTIVE);
  });

  it('lets exactly one of two concurrent redemptions through', async () => {
    const raw = `tok-${Math.random().toString(36).slice(2)}`;
    await invited(raw);

    const results = await Promise.allSettled([
      service.setPasswordFromInvitation({ token: raw, password: 'Una-clave-larga-1' } as never),
      service.setPasswordFromInvitation({ token: raw, password: 'Otra-clave-larga-2' } as never),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});
