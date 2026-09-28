import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Organization } from '../../organizations/entities/organization.entity';
import { Role } from '../../roles/entities/role.entity';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { UserSecurity } from '../../users/entities/user-security.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { KeyManagementService } from './key-management.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { AuthConfig } from '../auth.config';

/**
 * "Remember me", and what happens when a session is left alone — against Postgres, because both
 * are decided by what `refresh_tokens` records and what a rotation reads back.
 *
 * The complaint this pins down: the interface signed a person out after fifteen idle minutes, and
 * a reload put them straight back in. Three things made that possible, and each has a test here:
 *
 *  - the sign-out needed a valid access token, which had just expired, so it ended nothing;
 *  - the server gave every session a fourteen-day idle window, remembered or not;
 *  - "remember me" was re-inferred from a row's lifetime instead of being recorded.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('remembered and ordinary sessions', () => {
  jest.setTimeout(120_000);

  const REFRESH_SECRET = 'session-kinds-spec-refresh-secret-kinds-spec';
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

    org = await ds.getRepository(Organization).save({ legalName: `KIND ${unique()}` } as Organization);
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


  async function signIn(rememberMe: boolean) {
    const full = (await ds.getRepository(User).findOne({ where: { id: operator.id }, relations: ['roles', 'security'] }))!;
    return tokens.generateAuthResponse(full, {}, undefined, undefined, rememberMe);
  }

  /** Move a whole family back in time: when it was opened, and when it was last used. */
  async function age(sessionId: string, opts: { openedAgoMs?: number; idleForMs?: number }) {
    if (opts.openedAgoMs !== undefined) {
      await ds.query(
        `UPDATE refresh_tokens SET created_at = now() - ($2 || ' milliseconds')::interval WHERE session_id = $1`,
        [sessionId, String(opts.openedAgoMs)],
      );
    }
    if (opts.idleForMs !== undefined) {
      await ds.query(
        `UPDATE refresh_tokens SET last_active_at = now() - ($2 || ' milliseconds')::interval WHERE session_id = $1`,
        [sessionId, String(opts.idleForMs)],
      );
    }
  }

  const minutes = (n: number) => n * 60 * 1000;
  const hours = (n: number) => minutes(n * 60);

  it('records "remember me" when the session begins and keeps it across rotations', async () => {
    const start = await signIn(true);
    expect(start.rememberMe).toBe(true);

    const first = await sessions.refreshAccessToken(start.refreshToken);
    const second = await sessions.refreshAccessToken(first.refreshToken);
    expect(first.rememberMe).toBe(true);
    expect(second.rememberMe).toBe(true);

    const rows = await ds.getRepository(RefreshToken).find({ where: { sessionId: start.sessionId } });
    expect(rows.length).toBe(3);
    expect(rows.every((row) => row.rememberMe)).toBe(true);
  });

  it('an ordinary session stays ordinary across rotations', async () => {
    const start = await signIn(false);
    const rotated = await sessions.refreshAccessToken(start.refreshToken);
    expect(rotated.rememberMe).toBe(false);
    await expect(sessions.isRememberedSession(start.sessionId)).resolves.toBe(false);
  });

  it('ends an ordinary session left unused past its idle window', async () => {
    const start = await signIn(false);
    await age(start.sessionId, { idleForMs: AuthConfig.SESSION_IDLE_TIMEOUT_STANDARD + minutes(1) });

    await expect(sessions.refreshAccessToken(start.refreshToken)).rejects.toThrow();
    const rows = await ds.getRepository(RefreshToken).find({ where: { sessionId: start.sessionId } });
    expect(rows.every((row) => row.isRevoked)).toBe(true);
  });

  it('keeps a remembered session through the same idle time', async () => {
    const start = await signIn(true);
    await age(start.sessionId, { idleForMs: AuthConfig.SESSION_IDLE_TIMEOUT_STANDARD + minutes(1) });

    await expect(sessions.refreshAccessToken(start.refreshToken)).resolves.toMatchObject({ rememberMe: true });
  });

  it('ends an ordinary session after a working day, however active', async () => {
    const start = await signIn(false);
    await age(start.sessionId, { openedAgoMs: AuthConfig.SESSION_ABSOLUTE_MAX_STANDARD + minutes(1), idleForMs: 0 });

    await expect(sessions.refreshAccessToken(start.refreshToken)).rejects.toThrow();
  });

  it('lets a remembered session run past a working day', async () => {
    const start = await signIn(true);
    await age(start.sessionId, { openedAgoMs: hours(13), idleForMs: 0 });

    await expect(sessions.refreshAccessToken(start.refreshToken)).resolves.toBeDefined();
  });

  describe('signing out with the refresh token alone', () => {
    it('ends the whole family, so the next refresh — a reload — cannot bring it back', async () => {
      const start = await signIn(false);
      const rotated = await sessions.refreshAccessToken(start.refreshToken);

      // No access token is involved at all: this is the inactivity sign-out after it expired.
      await sessions.endSessionByRefreshToken(rotated.refreshToken);

      const rows = await ds.getRepository(RefreshToken).find({ where: { sessionId: start.sessionId } });
      expect(rows.every((row) => row.isRevoked)).toBe(true);
      await expect(sessions.refreshAccessToken(rotated.refreshToken)).rejects.toThrow();
    });

    it('does nothing, quietly, for a token that does not verify', async () => {
      const start = await signIn(false);

      await expect(sessions.endSessionByRefreshToken('not-a-token')).resolves.toBeUndefined();
      await expect(sessions.endSessionByRefreshToken(undefined)).resolves.toBeUndefined();

      const forged = new JwtService({}).sign(
        { id: operator.id, jti: start.refreshTokenId, sessionId: start.sessionId },
        { secret: 'some-other-secret-entirely-some-other', issuer: 'virteex-api', audience: 'virteex-web' },
      );
      await sessions.endSessionByRefreshToken(forged);

      const rows = await ds.getRepository(RefreshToken).find({ where: { sessionId: start.sessionId } });
      expect(rows.some((row) => !row.isRevoked)).toBe(true);
    });
  });
});
