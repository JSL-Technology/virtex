import { EventsGateway } from './events.gateway';

/**
 * Presence never crosses a tenant boundary.
 *
 * The gateway announced every connection with `this.server.emit(...)`, which reaches EVERY socket
 * on the server. So each tenant learned when any user of any other tenant came online: staff names
 * and working hours, disclosed by the feature meant to show colleagues. This repository has already
 * shipped a leak of the same shape once — a migration records webhook subscribers receiving every
 * tenant's payloads — which is why this is a test and not a code review note.
 */
describe('EventsGateway · aislamiento entre empresas', () => {
  const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  function build(options: { revokedSessions?: string[] } = {}) {
    const emitted: Array<{ room: string | null; event: string; data: unknown }> = [];
    const sockets = new Map<string, { disconnect: jest.Mock }>();
    const server = {
      emit: (event: string, data: unknown) => emitted.push({ room: null, event, data }),
      to: (room: string) => ({
        emit: (event: string, data: unknown) => emitted.push({ room, event, data }),
      }),
      sockets: { sockets },
    };

    const revoked = new Set(options.revokedSessions ?? []);

    const gateway = new EventsGateway(
      { getUser: async () => ({ security: { tokenVersion: 1 } }) } as never,
      { getPublicKey: () => 'key' } as never,
      // The revocation registry. A WebSocket authenticates once and never makes another
      // authenticated request, so unless the handshake asks — and unless a revocation can reach
      // an already-open socket — "cerrar sesión" leaves it receiving the tenant's events until
      // the access token expires on its own.
      { isRevoked: async (id?: string) => Boolean(id && revoked.has(id)) } as never,
    );
    (gateway as unknown as { server: unknown }).server = server;
    return { gateway, emitted, sockets };
  }

  function connect(
    gateway: EventsGateway,
    userId: string,
    organizationId: string,
    socketId: string,
    sessionId = `session-${socketId}`,
  ) {
    const joined: string[] = [];
    const client = {
      id: socketId,
      handshake: { headers: { cookie: 'access_token=t' } },
      join: (room: string) => joined.push(room),
      disconnect: jest.fn(),
    };
    // The token check is exercised by its own path; here the tenant binding is what is under test.
    jest
      .spyOn(gateway as unknown as { verifyAccessToken: () => unknown }, 'verifyAccessToken')
      .mockReturnValue({ id: userId, tokenVersion: 1, organizationId, sessionId });

    return { client, joined, done: gateway.handleConnection(client as never) };
  }

  it('el socket entra en la sala de su empresa', async () => {
    const { gateway } = build();
    const a = connect(gateway, 'user-a', ORG_A, 'sock-a');
    await a.done;
    expect(a.joined).toEqual([`org:${ORG_A}`]);
  });

  it('anuncia la conexión solo a la sala de su empresa, nunca a todos', async () => {
    const { gateway, emitted } = build();
    await connect(gateway, 'user-a', ORG_A, 'sock-a').done;

    expect(emitted).toHaveLength(1);
    expect(emitted[0].room).toBe(`org:${ORG_A}`);
    expect(emitted[0].data).toEqual({ userId: 'user-a', isOnline: true });

    // The regression: a null room means it went to every socket on the server.
    expect(emitted.filter((e) => e.room === null)).toEqual([]);
  });

  it('la empresa B no recibe la presencia de la empresa A', async () => {
    const { gateway, emitted } = build();
    await connect(gateway, 'user-a', ORG_A, 'sock-a').done;
    await connect(gateway, 'user-b', ORG_B, 'sock-b').done;

    const roomsForA = emitted.filter((e) => (e.data as { userId: string }).userId === 'user-a');
    expect(roomsForA.every((e) => e.room === `org:${ORG_A}`)).toBe(true);
    expect(roomsForA.some((e) => e.room === `org:${ORG_B}`)).toBe(false);
  });

  it('la desconexión también se anuncia solo dentro de la empresa', async () => {
    const { gateway, emitted } = build();
    const a = connect(gateway, 'user-a', ORG_A, 'sock-a');
    await a.done;
    emitted.length = 0;

    gateway.handleDisconnect({ id: 'sock-a' } as never);

    expect(emitted).toEqual([
      { room: `org:${ORG_A}`, event: 'user-status-update', data: { userId: 'user-a', isOnline: false } },
    ]);
  });

  it('rechaza un token sin empresa en vez de dejar un socket sin sala', async () => {
    const { gateway, emitted } = build();
    const client = {
      id: 'sock-x',
      handshake: { headers: { cookie: 'access_token=t' } },
      join: jest.fn(),
      disconnect: jest.fn(),
    };
    jest
      .spyOn(gateway as unknown as { verifyAccessToken: () => unknown }, 'verifyAccessToken')
      .mockReturnValue({ id: 'user-x', tokenVersion: 1 });

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  describe('una sesión revocada no sobrevive en el socket', () => {
    /**
     * `logout` y «revocar este dispositivo» NO suben `tokenVersion` —a propósito, porque eso
     * cerraría todas las demás sesiones—, así que su único efecto sobre un token de acceso ya
     * emitido es la lista de revocación. El camino HTTP la consulta en cada petición; este
     * handshake no la consultaba, de modo que un token capturado seguía abriendo un socket
     * después de que la víctima pulsara «cerrar sesión», y ese socket recibía los eventos de la
     * empresa hasta que el token caducaba solo (hasta quince minutos).
     */
    it('rechaza el handshake de una sesión ya revocada', async () => {
      const { gateway } = build({ revokedSessions: ['session-sock-a'] });
      const a = connect(gateway, 'user-a', ORG_A, 'sock-a');
      await a.done;

      expect(a.client.disconnect).toHaveBeenCalled();
      expect(a.joined).toEqual([]);
    });

    it('acepta el handshake de una sesión viva', async () => {
      const { gateway } = build({ revokedSessions: ['otra-sesion'] });
      const a = connect(gateway, 'user-a', ORG_A, 'sock-a');
      await a.done;

      expect(a.client.disconnect).not.toHaveBeenCalled();
      expect(a.joined).toEqual([`org:${ORG_A}`]);
    });

    /**
     * El handshake cierra la puerta a las conexiones NUEVAS; esto la cierra para la que ya está
     * dentro. Sin ello, la lista de revocación no tiene sobre qué actuar en un socket abierto.
     */
    it('cuelga el socket que ya estaba abierto cuando su sesión se revoca', async () => {
      const { gateway, sockets } = build();
      const a = connect(gateway, 'user-a', ORG_A, 'sock-a');
      await a.done;

      const socket = { disconnect: jest.fn() };
      sockets.set('sock-a', socket);

      gateway.handleSessionsRevoked({ userId: 'user-a', sessionIds: ['session-sock-a'] } as never);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('no toca el socket de otra persona', async () => {
      const { gateway, sockets } = build();
      const a = connect(gateway, 'user-a', ORG_A, 'sock-a');
      const b = connect(gateway, 'user-b', ORG_B, 'sock-b');
      await Promise.all([a.done, b.done]);

      const socketA = { disconnect: jest.fn() };
      const socketB = { disconnect: jest.fn() };
      sockets.set('sock-a', socketA);
      sockets.set('sock-b', socketB);

      gateway.handleSessionsRevoked({ userId: 'user-a', sessionIds: ['session-sock-a'] } as never);

      expect(socketA.disconnect).toHaveBeenCalled();
      expect(socketB.disconnect).not.toHaveBeenCalled();
    });

    it('deja en paz otra sesión del mismo usuario', async () => {
      // Revocar UN dispositivo no es cerrar la sesión en todos: el resto sigue.
      const { gateway, sockets } = build();
      const a = connect(gateway, 'user-a', ORG_A, 'sock-a', 'session-viva');
      await a.done;

      const socket = { disconnect: jest.fn() };
      sockets.set('sock-a', socket);

      gateway.handleSessionsRevoked({ userId: 'user-a', sessionIds: ['session-otra'] } as never);

      expect(socket.disconnect).not.toHaveBeenCalled();
    });
  });
});
