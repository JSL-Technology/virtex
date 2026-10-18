import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AlertsPanel } from './alerts-panel';
import { DashboardApiService } from '../../data/dashboard-api.service';

describe('AlertsPanel', () => {
  let fixture: ComponentFixture<AlertsPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AlertsPanel],
      providers: [
        provideRouter([]),
        {
          provide: DashboardApiService,
          useValue: {
            getAlerts: () =>
              of([
                {
                  id: 'period-unclosed',
                  severity: 'warning',
                  messageKey: 'dashboard.alerts.period_period_still_open_closing_date',
                  params: { period: 'September 2026' },
                  route: '/accounting/periods',
                },
              ]),
          },
        },
      ],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      'dashboard.alerts.period_period_still_open_closing_date':
        'Period {{period}} is still open and its closing date has passed.',
      'dashboard.alerts_panel.review': 'Review',
    });
    translate.use('en');

    fixture = TestBed.createComponent(AlertsPanel);
    fixture.detectChanges();
  });

  it('writes each alert as its own sentence, with a way to act on it', () => {
    const text = fixture.nativeElement.textContent as string;
    // QA M2: the template appended `.TITLE` and `.BODY` to a one-sentence key, so the panel
    // showed `[[dashboard.alerts…TITLE]]` instead of the warning.
    expect(text).toContain('Period September 2026 is still open and its closing date has passed.');
    expect(text).not.toContain('TITLE');
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a.alert-action');
    expect(link.getAttribute('href')).toBe('/accounting/periods');
  });
});
