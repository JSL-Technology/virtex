import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { IdleService } from './idle.service';
import { AuthService, SessionPolicy } from './auth';
import { AuthQueueService } from './auth-queue.service';
import { LAST_ACTIVITY_STORAGE_KEY } from './activity-tracker.service';

/**
 * The inactivity sign-out: only for sessions the person did not ask to be remembered, warned
 * about for its last minute, measured in wall-clock time shared by every tab, and never the cause
 * of losing a session someone is actively working in.
 */
describe('IdleService', () => {
  const minutes = (n: number) => n * 60_000;
  const ordinary: SessionPolicy = { persistent: false, inactivityTimeoutMs: minutes(15) };
  const remembered: SessionPolicy = { persistent: true, inactivityTimeoutMs: null };

  let authenticated: ReturnType<typeof signal<boolean>>;
  let policy: ReturnType<typeof signal<SessionPolicy | null>>;
  let auth: { isAuthenticated: () => boolean; sessionPolicy: () => SessionPolicy | null; logout: jest.Mock; refreshAccessToken: jest.Mock };
  let idle: IdleService;

  const setUp = (sessionPolicy: SessionPolicy) => {
    authenticated = signal(true);
    policy = signal<SessionPolicy | null>(sessionPolicy);
    auth = {
      isAuthenticated: () => authenticated(),
      sessionPolicy: () => policy(),
      logout: jest.fn(() => authenticated.set(false)),
      refreshAccessToken: jest.fn(() => of({ user: {} })),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: auth }, AuthQueueService],
    });
    idle = TestBed.inject(IdleService);
    TestBed.flushEffects();
  };

  const act = () => document.dispatchEvent(new KeyboardEvent('keydown'));

  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers({ now: new Date('2026-09-28T10:00:00Z') });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('does nothing for a remembered session', () => {
    setUp(remembered);
    jest.advanceTimersByTime(minutes(60));
    expect(auth.logout).not.toHaveBeenCalled();
    expect(idle.warningSecondsLeft()).toBeNull();
  });

  it('warns during the last minute, then signs an ordinary session out, saying why', () => {
    setUp(ordinary);

    jest.advanceTimersByTime(minutes(14) - 1_000);
    expect(idle.warningSecondsLeft()).toBeNull();

    jest.advanceTimersByTime(2_000);
    expect(idle.warningSecondsLeft()).toBe(59);

    jest.advanceTimersByTime(minutes(1));
    expect(auth.logout).toHaveBeenCalledWith(true, 'idle');
  });

  it('activity keeps the session, and dismisses the warning', () => {
    setUp(ordinary);
    jest.advanceTimersByTime(minutes(14) + 30_000);
    expect(idle.warningSecondsLeft()).not.toBeNull();

    act();
    jest.advanceTimersByTime(1_000);
    expect(idle.warningSecondsLeft()).toBeNull();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('counts activity in another tab', () => {
    setUp(ordinary);
    jest.advanceTimersByTime(minutes(14));
    // Another tab wrote the shared record.
    localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));

    jest.advanceTimersByTime(minutes(10));
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('signs out at once a laptop that slept past the timeout', () => {
    setUp(ordinary);
    // Timers do not run while a machine sleeps; the wall clock does.
    localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now() - minutes(40)));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(auth.logout).toHaveBeenCalledWith(true, 'idle');
  });

  it('renews the session of someone who is active but making no requests', () => {
    setUp(ordinary);
    for (let i = 0; i < 11; i++) {
      act();
      jest.advanceTimersByTime(minutes(1));
    }
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('"Stay signed in" renews at once and clears the warning', () => {
    setUp(ordinary);
    jest.advanceTimersByTime(minutes(14) + 30_000);

    idle.stayActive();
    expect(auth.refreshAccessToken).toHaveBeenCalled();
    expect(idle.warningSecondsLeft()).toBeNull();
  });

  it('agrees when the server has already ended the session', () => {
    setUp(ordinary);
    auth.refreshAccessToken.mockReturnValue(throwError(() => new Error('401')));

    idle.stayActive();
    expect(auth.logout).toHaveBeenCalledWith(false, 'expired');
  });
});
