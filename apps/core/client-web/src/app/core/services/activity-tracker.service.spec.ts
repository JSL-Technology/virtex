import { TestBed } from '@angular/core/testing';
import { ActivityTrackerService, LAST_ACTIVITY_STORAGE_KEY } from './activity-tracker.service';

/**
 * The shared record of the last activity: wall-clock time in storage, so a reload and every tab
 * see the same moment. See the service for why a per-tab timer was not enough.
 */
describe('ActivityTrackerService', () => {
  let tracker: ActivityTrackerService;

  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers({ now: new Date('2026-09-28T10:00:00Z') });
    TestBed.configureTestingModule({});
    tracker = TestBed.inject(ActivityTrackerService);
  });

  afterEach(() => jest.useRealTimers());

  it('has no record until something happens', () => {
    expect(tracker.lastActivity()).toBeNull();
    expect(tracker.idleForMs()).toBeNull();
  });

  it('records activity in storage, where a reload and the other tabs read it', () => {
    tracker.touch(true);
    expect(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY)).toBe(String(Date.now()));

    jest.advanceTimersByTime(90_000);
    expect(tracker.idleForMs()).toBe(90_000);
  });

  it('writes at most every few seconds for ordinary activity, and at once when forced', () => {
    tracker.touch(true);
    const first = tracker.lastActivity();

    jest.advanceTimersByTime(1_000);
    tracker.touch();
    expect(tracker.lastActivity()).toBe(first);

    tracker.touch(true);
    expect(tracker.lastActivity()).toBe(Date.now());
  });

  it('forgets the record on sign-out', () => {
    tracker.touch(true);
    tracker.clear();
    expect(tracker.lastActivity()).toBeNull();
  });
});
