import { TestBed } from '@angular/core/testing';
import { AuthQueueService } from './auth-queue.service';
import { take } from 'rxjs/operators';

describe('AuthQueueService', () => {
  let service: AuthQueueService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AuthQueueService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should start with isRefreshing false', () => {
    expect(service.isRefreshingToken).toBe(false);
  });

  it('should update state on startRefresh', () => {
    service.startRefresh();
    expect(service.isRefreshingToken).toBe(true);
  });

  it('should update state on finishRefreshSuccess', () => {
    service.startRefresh();
    service.finishRefreshSuccess();
    expect(service.isRefreshingToken).toBe(false);
  });

  it('should emit true on finishRefreshSuccess', (done) => {
    service.startRefresh();
    service.waitForTokenRefresh().pipe(take(1)).subscribe(result => {
        expect(result).toBe(true);
        done();
    });
    service.finishRefreshSuccess();
  });

  it('should emit false on finishRefreshError', (done) => {
    service.startRefresh();
    service.waitForTokenRefresh().pipe(take(1)).subscribe(result => {
        expect(result).toBe(false);
        done();
    });
    service.finishRefreshError();
  });
});
