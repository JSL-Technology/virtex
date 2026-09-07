import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { StatusBarComponent } from './status-bar.component';
import { StatusBarService, CurrentPeriod } from './status-bar.service';
import { AuthService } from '../../core/services/auth';

/**
 * The bar says whether work will be accepted, before the work.
 *
 * Its whole reason to occupy permanent screen space is that a closed period, a missing company or a
 * dropped connection are facts the system already holds and today only reveals by rejecting a form
 * that somebody has already filled in.
 */
describe('StatusBarComponent', () => {
  let fixture: ComponentFixture<StatusBarComponent>;

  async function render(period: CurrentPeriod | null, organization: unknown = {
    legalName: 'Nortex Comercial',
    baseCurrency: 'DOP',
  }) {
    await TestBed.configureTestingModule({
      imports: [StatusBarComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: StatusBarService,
          useValue: { period: signal(period).asReadonly(), refresh: jest.fn() },
        },
        { provide: AuthService, useValue: { currentUser: signal({ organization }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusBarComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const open: CurrentPeriod = {
    id: 'p1', startDate: '2026-09-01', endDate: '2026-09-30', status: 'OPEN',
  };

  it('nombra la empresa en la que se está actuando', async () => {
    const el = await render(open);
    expect(el.textContent).toContain('Nortex Comercial');
  });

  it('dice el periodo y que está abierto', async () => {
    // The translate pipe is stubbed in tests and returns the key unsubstituted, so the month is
    // asserted where the component actually decides it rather than through the rendered sentence.
    const el = await render(open);
    expect(fixture.componentInstance['periodLabel']()).toBe('2026-09');
    expect(el.querySelector('.sb__item--ok')).toBeTruthy();
    expect(el.textContent).toContain('STATUS_BAR.PERIOD_OPEN');
  });

  it('distingue un periodo cerrado, que es el que impide trabajar', async () => {
    const el = await render({ ...open, status: 'CLOSED' });
    expect(el.querySelector('.sb__item--closed')).toBeTruthy();
    expect(el.querySelector('.sb__item--ok')).toBeNull();
  });

  it('muestra la moneda base', async () => {
    const el = await render(open);
    expect(el.textContent).toContain('DOP');
  });

  it('no inventa un periodo cuando el inquilino aún no tiene calendario', async () => {
    // Onboarding is a normal state; showing a made-up period would be worse than showing none.
    const el = await render(null);
    expect(fixture.componentInstance['periodLabel']()).toBeNull();
    expect(el.textContent).not.toContain('STATUS_BAR.PERIOD_OPEN');
    expect(el.textContent).not.toContain('STATUS_BAR.PERIOD_CLOSED');
    expect(el.querySelector('.sb__item--ok')).toBeNull();
  });

  it('pide el estado al montarse', async () => {
    await render(open);
    const service = TestBed.inject(StatusBarService);
    expect(service.refresh).toHaveBeenCalled();
  });
});
