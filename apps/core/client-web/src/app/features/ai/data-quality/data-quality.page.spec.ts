import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DataQualityPage } from './data-quality.page';
import { DataQualityApiService, DuplicateList } from './data-quality.service';
import { NotificationService } from '../../../core/services/notification';

const list: DuplicateList = {
  total: 1,
  counts: { CUSTOMER: 1 },
  items: [
    {
      id: 'd1', entityType: 'CUSTOMER', recordAId: 'a', recordBId: 'b', labelA: 'Distribuidora Peña, S.R.L.', labelB: 'DISTRIBUIDORA PENA SRL',
      linkA: '/contacts/customers/a/edit', linkB: '/contacts/customers/b/edit', score: 0.91, reasons: ['similar_name', 'same_email'], status: 'OPEN', decidedAt: null,
    },
  ],
};

describe('DataQualityPage', () => {
  let fixture: ComponentFixture<DataQualityPage>;
  let api: Record<string, jest.Mock>;

  beforeEach(async () => {
    api = {
      list: jest.fn().mockReturnValue(of(list)),
      scan: jest.fn().mockReturnValue(of({ CUSTOMER: { found: 1, added: 1, stale: 0 } })),
      decide: jest.fn().mockReturnValue(of({})),
    };
    await TestBed.configureTestingModule({
      imports: [DataQualityPage],
      providers: [
        provideRouter([]),
        { provide: DataQualityApiService, useValue: api },
        { provide: NotificationService, useValue: { showHttpError: jest.fn(), showSuccess: jest.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DataQualityPage);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows each pair with why it was proposed, and only the types the server counted', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Distribuidora Peña, S.R.L.');
    expect(text).toContain('ai.data_quality.reason.same_email');
    expect(fixture.componentInstance.types()).toEqual(['CUSTOMER']);
  });

  it('records a decision and reloads', () => {
    fixture.componentInstance.decide(list.items[0], 'NOT_DUPLICATE');
    expect(api['decide']).toHaveBeenCalledWith('d1', 'NOT_DUPLICATE');
    expect(api['list']).toHaveBeenCalledTimes(2);
  });

  it('filters by type and status', () => {
    fixture.componentInstance.setType('CUSTOMER');
    fixture.componentInstance.setStatus('NOT_DUPLICATE');
    expect(api['list']).toHaveBeenLastCalledWith({ type: 'CUSTOMER', status: 'NOT_DUPLICATE', limit: 100 });
  });
});
