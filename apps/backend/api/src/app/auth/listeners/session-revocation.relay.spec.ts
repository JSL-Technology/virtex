import { AuthSessionsRevokedEvent } from '../events/auth.events';
import { SessionRevocationRelay } from './session-revocation.relay';

describe('SessionRevocationRelay', () => {
  it('publishes every revoked session of the user on the cross-replica channel', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const relay = new SessionRevocationRelay({ publish } as never);
    const sessionIds = ['sess-1', 'sess-2'];

    await relay.relay(new AuthSessionsRevokedEvent('user-1', sessionIds));

    expect(publish).toHaveBeenCalledWith({ userId: 'user-1', sessionIds: ['sess-1', 'sess-2'] });
    // A copy: the broadcaster serialises what it is given, and must not alias the event's array.
    expect(publish.mock.calls[0][0].sessionIds).not.toBe(sessionIds);
  });
});
