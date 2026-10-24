import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CloseAssistantComponent } from './close-assistant.component';
import { CloseAssistantService, CloseAssistantView } from './close-assistant.service';
import { AuthService } from '../../../core/services/auth';

const view: CloseAssistantView = {
  period: { id: 'p1', name: 'Septiembre 2026', startDate: '2026-09-01', endDate: '2026-09-30', status: 'OPEN' },
  progress: 50,
  steps: [
    { id: 'unposted', description: '2 asientos sin contabilizar', note: null, done: false, pending: 2, link: '/journal-entries', priority: 1 },
    { id: 'approvals', description: 'Aprobaciones', note: null, done: true, pending: 0, link: null, priority: 2 },
  ],
  openAnomalies: { critical: 1, high: 1, medium: 0, low: 0 },
  mailedBillsToReview: 3,
  ready: false,
};

describe('CloseAssistantComponent', () => {
  function render() {
    const api = {
      view: jest.fn(() => of(view)),
      plan: jest.fn(() => of(null)),
      requestPlan: jest.fn(() => of({ id: 'r1', kind: 'CLOSE_ASSISTANT', status: 'SUCCEEDED', createdAt: '', finishedAt: '', error: null, content: { title: 'Plan', summary: 'Aún no', sections: [], recommendations: [{ action: 'Contabilizar', why: 'Faltan dos' }] } })),
    };
    TestBed.configureTestingModule({
      imports: [CloseAssistantComponent],
      providers: [provideRouter([]), { provide: CloseAssistantService, useValue: api }, { provide: AuthService, useValue: { hasPermissions: () => true } }],
    });
    const fixture = TestBed.createComponent(CloseAssistantComponent);
    fixture.componentRef.setInput('periodId', 'p1');
    fixture.detectChanges();
    return { fixture, api };
  }

  it('lists the steps in order with a way to resolve each, and what else deserves a look', () => {
    const { fixture } = render();
    const steps = fixture.nativeElement.querySelectorAll('.ca__step');
    expect(steps[0].textContent).toContain('2 asientos sin contabilizar');
    expect(steps[0].querySelector('a').getAttribute('href')).toBe('/journal-entries');
    expect(steps[1].querySelector('a')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('ai.close.open_anomalies');
    expect(fixture.nativeElement.textContent).toContain('ai.close.mailed_bills');
  });

  it('writes the plan on request and shows it', () => {
    const { fixture, api } = render();
    fixture.componentInstance.writePlan();
    fixture.detectChanges();
    expect(api.requestPlan).toHaveBeenCalledWith('p1');
    expect(fixture.nativeElement.querySelector('.ca__content').textContent).toContain('Contabilizar');
  });
});
