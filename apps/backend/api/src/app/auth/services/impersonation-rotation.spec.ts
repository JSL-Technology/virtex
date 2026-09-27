import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as jwt from 'jsonwebtoken';
import { Organization } from '../../organizations/entities/organization.entity';
import { Role } from '../../roles/entities/role.entity';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { UserSecurity } from '../../users/entities/user-security.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { KeyManagementService } from './key-management.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * S-4: an impersonated session used to stop being one at its first rotation. The refresh path
 * rebuilt the token's claims from scratch — `isImpersonating` and `originalUserId` were not among
 * them — so after fifteen minutes the operator held an ordinary session of the target: renewable
 * for a month, pinned to nothing, absent from the audit trail as an impersonation.
 *
 * Proven against Postgres with the real TokenService and SessionService, because the facts now
 * live in `refresh_tokens` and the point is what the rotation reads back from there.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('impersonation survives token rotation', () => {
  jest.setTimeout(120_000);

  const REFRESH_SECRET = 'rotation-spec-refresh-secret-rotation-spec';
  let ds: DataSource;
  let tokens: TokenService;
  let sessions: SessionService;
  let keys: KeyManagementService;
  let org: Organization;
  let operator: User;
  let target: User;

  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

    keys = new KeyManagementService({ get: () => undefined } as never);
    keys.onModuleInit();

    org = await ds.getRepository(Organization).save({ legalName: `ROT ${unique()}` } as Organization);
    const role = await ds.getRepository(Role).save({ name: `Viewer ${unique()}`, permissions: ['invoices:view'], organizationId: org.id } as Role);
    const mk = (name: string) =>
      ds.getRepository(User).save({
        firstName: name, lastName: 'X', email: `${name}-${unique()}@example.test`,
        organizationId: org.id, status: UserStatus.ACTIVE, roles: [role],
        security: Object.assign(new UserSecurity(), { tokenVersion: 0 }),
      } as unknown as User);
    operator = await mk('operator');
    target = await mk('target');

    const usersService = {
      findUserByIdForAuth: async (id: string) => {
        const user = await ds.getRepository(User).findOne({ where: { id }, relations: ['roles', 'security'] });
        return user ?? null;
      },
    };
    const securityAnalysis = {
      resetLoginAttempts: jest.fn(),
      parseUserAgent: () => ({ browser: 'Chrome', os: 'Linux', deviceType: 'desktop' }),
    };
    const refreshRepo = ds.getRepository(RefreshToken);
    const jwtService = new JwtService({});
    const config = { getOrThrow: () => REFRESH_SECRET, get: () => undefined };

    tokens = new TokenService(
      jwtService,
      config as never,
      refreshRepo,
      { clearUserSession: jest.fn() } as never,
      usersService as never,
      {} as never,
      { getLocation: () => null } as never,
      keys,
      {} as never,
      { encrypt: (v: string) => `enc:${v}` } as never,
      securityAnalysis as never,
    );
    sessions = new SessionService(
      usersService as never,
      refreshRepo,
      ds.getRepository(UserSecurity),
      jwtService,
      config as never,
      { clearUserSession: jest.fn() } as never,
      securityAnalysis as never,
      tokens,
      { emit: jest.fn() } as never,
      { getLocation: () => null } as never,
      { encrypt: (v: string) => `enc:${v}` } as never,
      { isRevoked: async () => false, revoke: jest.fn() } as never,
      keys,
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const claimsOf = (accessToken: string) => jwt.decode(accessToken) as JwtPayload;

  async function impersonate() {
    const full = (await ds.getRepository(User).findOne({ where: { id: target.id }, relations: ['roles', 'security'] }))!;
    return tokens.generateAuthResponse(full, {
      isImpersonating: true,
      originalUserId: operator.id,
      organizationId: org.id,
    });
  }

  it('keeps the impersonation marker, the operator and the pinned tenant across two rotations', async () => {
    const start = await impersonate();
    expect(claimsOf(start.accessToken)).toMatchObject({ isImpersonating: true, originalUserId: operator.id });

    const first = await sessions.refreshAccessToken(start.refreshToken);
    const second = await sessions.refreshAccessToken(first.refreshToken);

    for (const rotated of [first, second]) {
      expect(claimsOf(rotated.accessToken)).toMatchObject({
        id: target.id,
        isImpersonating: true,
        originalUserId: operator.id,
        organizationId: org.id,
      });
    }
  });

  it('never extends the window: every row of the family expires with the first one', async () => {
    const start = await impersonate();
    const first = await sessions.refreshAccessToken(start.refreshToken);
    await sessions.refreshAccessToken(first.refreshToken);

    const rows = await ds.getRepository(RefreshToken).find({
      where: { sessionId: start.sessionId },
      order: { createdAt: 'ASC' },
    });
    expect(rows.length).toBe(3);
    const openedAt = rows[0].createdAt.getTime();
    for (const row of rows) {
      expect(row.impersonatorId).toBe(operator.id);
      expect(row.impersonationOrganizationId).toBe(org.id);
      // Thirty minutes from when the impersonation BEGAN, give or take the clock of the insert.
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(openedAt + 30 * 60_000 + 5_000);
    }
  });

  it('a normal session cannot be turned into an impersonation by a rotation', async () => {
    const full = (await ds.getRepository(User).findOne({ where: { id: target.id }, relations: ['roles', 'security'] }))!;
    const start = await tokens.generateAuthResponse(full);
    const rotated = await sessions.refreshAccessToken(start.refreshToken);
    expect(claimsOf(rotated.accessToken).isImpersonating).toBeUndefined();
    expect(claimsOf(rotated.accessToken).originalUserId).toBeUndefined();
  });

  it('ends the impersonated session at rotation once its operator is blocked', async () => {
    const start = await impersonate();
    await ds.getRepository(User).update({ id: operator.id }, { status: UserStatus.BLOCKED });
    try {
      await expect(sessions.refreshAccessToken(start.refreshToken)).rejects.toThrow();
      const live = await ds.getRepository(RefreshToken).count({
        where: { sessionId: start.sessionId, isRevoked: false },
      });
      expect(live).toBe(0);
    } finally {
      await ds.getRepository(User).update({ id: operator.id }, { status: UserStatus.ACTIVE });
    }
  });
});
