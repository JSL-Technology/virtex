import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { environment } from '../../../../environments/environment';
import { MergeAccountsPage } from './merge-accounts.page';
import { MergePreview } from '../data/chart-of-accounts.service';

/**
 * The wizard announced «42 transactions, balance 1,500.75» for any two accounts and reported a
 * merge that never left the browser. It now reads the server's analysis and queues the real job.
 */
describe('MergeAccountsPage', () => {
  const API = `${environment.apiUrl}/chart-of-accounts`;
  const dialog = { confirm: jest.fn() };
  const notifications = { showSuccess: jest.fn(), showHttpError: jest.fn() };
  let http: HttpTestingController;

  const preview = (over: Partial<MergePreview> = {}): MergePreview => ({
    source: { id: 'a-1', code: '1101', name: { es: 'Caja chica' }, type: 'ASSET', postedBalance: 150 },
    destination: { id: 'a-2', code: '1102', name: { es: 'Caja general' }, type: 'ASSET', postedBalance: 900 },
    linesToMove: 12,
    linesInClosedPeriods: 0,
    childAccountsToMove: 0,
    blockers: [],
    warnings: [],
    ...over,
  });

  function create() {
    TestBed.configureTestingModule({
      imports: [MergeAccountsPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DialogService, useValue: dialog },
        { provide: NotificationService, useValue: notifications },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MergeAccountsPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => {
    http.verify();
    jest.clearAllMocks();
  });

  it('asks the server what the merge would move', () => {
    const page = create();
    page.selectSource('a-1');
    page.selectDestination('a-2');

    page.analyze();

    const request = http.expectOne((r) => r.url === `${API}/merge/preview`);
    expect(request.request.params.get('sourceAccountId')).toBe('a-1');
    expect(request.request.params.get('destinationAccountId')).toBe('a-2');
    request.flush(preview());
    expect(page.preview()?.linesToMove).toBe(12);
  });

  it('does not offer the merge while the server would refuse it', () => {
    const page = create();
    page.selectSource('a-1');
    page.selectDestination('a-2');
    page.analyze();
    http.expectOne((r) => r.url === `${API}/merge/preview`).flush(
      preview({ blockers: ['chart_of_accounts.merge_types_must_match'] }),
    );
    page.reason.set('Cuenta duplicada');

    expect(page.canMerge()).toBe(false);
  });

  it('requires a reason, confirms, and queues the real merge', async () => {
    const page = create();
    page.selectSource('a-1');
    page.selectDestination('a-2');
    page.analyze();
    http.expectOne((r) => r.url === `${API}/merge/preview`).flush(preview());

    expect(page.canMerge()).toBe(false);
    page.reason.set('Cuenta duplicada');
    expect(page.canMerge()).toBe(true);

    dialog.confirm.mockResolvedValue(true);
    await page.merge();

    const merge = http.expectOne((r) => r.url === `${API}/merge` && r.method === 'POST');
    expect(merge.request.body).toEqual({ sourceAccountId: 'a-1', destinationAccountId: 'a-2', reason: 'Cuenta duplicada' });
    merge.flush({ jobId: 'job-1', messageKey: 'chart_of_accounts.merge_started', messageParams: { source: '1101', destination: '1102' } });

    expect(page.started()?.messageKey).toBe('chart_of_accounts.merge_started');
    expect(notifications.showSuccess).toHaveBeenCalled();
  });

  it('changing an account discards an analysis made for the old pair', () => {
    const page = create();
    page.selectSource('a-1');
    page.selectDestination('a-2');
    page.analyze();
    http.expectOne((r) => r.url === `${API}/merge/preview`).flush(preview());

    page.selectDestination('a-3');

    expect(page.preview()).toBeNull();
  });
});
