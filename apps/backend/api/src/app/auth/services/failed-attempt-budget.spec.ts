import { SecurityAnalysisService } from './security-analysis.service';

/**
 * El presupuesto de intentos fallidos se limpiaba en UN solo sitio: `AuthService.login`, en la
 * rama que emite sesión SIN segundo factor. Todos los demás caminos lo saltaban — la rama de 2FA
 * retorna antes de llegar, y lo mismo WebAuthn, los flujos federados y la invitación.
 *
 * Para una cuenta con 2FA el contador, por tanto, solo subía. Tras cinco erratas acumuladas a lo
 * largo de la vida de la cuenta, `failed_login_attempts + 1 >= MAX` era permanentemente cierto, y
 * CADA fallo posterior —una errata, una— bloqueaba la cuenta quince minutos. El control castigaba
 * justo a quien había activado el segundo factor, y más cuanto más tiempo llevara usándolo.
 *
 * Ahora cuelga de `TokenService.generateAuthResponse`, el único punto por el que pasa toda
 * autenticación correcta. Estas pruebas fijan las dos mitades: que limpia, y que la escritura es
 * una sentencia condicional sobre una fila y no un `save()` del grafo entero.
 */
describe('SecurityAnalysisService.resetLoginAttempts', () => {
  function build() {
    const query = jest.fn().mockResolvedValue([]);
    const service = new SecurityAnalysisService(
      {} as never, {} as never, {} as never, {} as never,
      { query } as never,
      {} as never, {} as never, {} as never,
    );
    return { service, query };
  }

  const userWithSecurity = () =>
    ({
      id: 'user-1',
      security: { id: 'sec-1', failedLoginAttempts: 4, lockoutUntil: new Date() },
    }) as never;

  it('clears the counter and the lockout in one statement', async () => {
    const { service, query } = build();

    await service.resetLoginAttempts(userWithSecurity());

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('UPDATE "user_security"');
    expect(sql).toContain('"failed_login_attempts" = 0');
    expect(sql).toContain('"lockout_until" = NULL');
    expect(params).toEqual(['sec-1']);
  });

  /**
   * Sin esto la sentencia escribiría en cada inicio de sesión de cada usuario, que es una escritura
   * que no dice nada. La condición va en el `WHERE`, no en JavaScript, para que dos sesiones
   * simultáneas no puedan pisarse.
   */
  it('only writes when there is something to clear', async () => {
    const { service, query } = build();

    await service.resetLoginAttempts(userWithSecurity());

    const [sql] = query.mock.calls[0];
    expect(sql).toContain('"failed_login_attempts" <> 0 OR "lockout_until" IS NOT NULL');
  });

  it('keeps the in-memory copy truthful for the rest of the request', async () => {
    const { service } = build();
    const user = userWithSecurity() as unknown as {
      security: { failedLoginAttempts: number; lockoutUntil: Date | null };
    };

    await service.resetLoginAttempts(user as never);

    expect(user.security.failedLoginAttempts).toBe(0);
    expect(user.security.lockoutUntil).toBeNull();
  });

  it('does nothing for a user with no security row rather than throwing', async () => {
    const { service, query } = build();

    await expect(service.resetLoginAttempts({ id: 'u' } as never)).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
});
