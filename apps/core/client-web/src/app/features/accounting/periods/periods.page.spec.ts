import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PeriodsPage } from './periods.page';

describe('Periods', () => {
  let component: PeriodsPage;
  let fixture: ComponentFixture<PeriodsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PeriodsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PeriodsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Periods close in order, so only the next one offers the action (QA M-13).
 */
describe('Periods — el siguiente cerrable', () => {
  const period = (id: string, start: string, end: string, status: 'OPEN' | 'CLOSED') =>
    ({ id, name: id, startDate: start, endDate: end, status }) as never;

  it('ofrece cerrar solo el período abierto más antiguo que ya terminó', async () => {
    await TestBed.configureTestingModule({ imports: [PeriodsPage] }).compileComponents();
    const component = TestBed.createComponent(PeriodsPage).componentInstance;

    component.periods.set([
      period('jan', '2020-01-01', '2020-01-31', 'CLOSED'),
      period('mar', '2020-03-01', '2020-03-31', 'OPEN'),
      period('feb', '2020-02-01', '2020-02-29', 'OPEN'),
      period('future', '2999-01-01', '2999-01-31', 'OPEN'),
    ]);

    expect(component.nextClosableId()).toBe('feb');
    expect(component.phase(component.periods()[3])).toBe('future');
    expect(component.statusKey('OPEN', component.periods()[3])).toBe('accounting.periods.status_future');
  });
});
