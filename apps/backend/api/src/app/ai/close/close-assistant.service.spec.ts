import { CloseAssistantService } from './close-assistant.service';
import { CloseReadinessRegistry } from '../../contracts/closing/close-readiness.contract';

function build() {
  const registry = new CloseReadinessRegistry();
  registry.provide({
    readiness: async () => ({
      period: { id: 'p-1', name: 'Septiembre 2026', startDate: '2026-09-01', endDate: '2026-09-30', status: 'OPEN' },
      checklist: [
        { id: 'fixed-assets-depreciation', descriptionKey: 'dep', isCompleted: false, noteKey: 'manual', resolutionLink: '/fixed-assets/depreciation' },
        { id: 'bank-reconciliation', descriptionKey: 'bank', params: { count: 4 }, isCompleted: false, details: { pendingCount: 4 } },
        { id: 'unposted-journal-entries', descriptionKey: 'unposted', params: { count: 2 }, isCompleted: false, details: { pendingCount: 2 } },
        { id: 'pending-general-approvals', descriptionKey: 'approvals', isCompleted: true, details: { pendingCount: 0 } },
      ],
    }),
  });
  const query = jest
    .fn()
    .mockResolvedValueOnce([{ severity: 'HIGH', n: 2 }, { severity: 'LOW', n: 5 }])
    .mockResolvedValueOnce([{ n: 3 }]);
  const i18n = { translate: (key: string, _language: string, params: Record<string, unknown>) => (params['count'] !== undefined ? `${key}:${params['count']}` : key) };
  const service = new CloseAssistantService(registry, { register: jest.fn() } as never, i18n as never, { query } as never);
  return { service };
}

describe('CloseAssistantService', () => {
  it('orders the checklist by what to do first, and adds what else in the period deserves a look', async () => {
    const view = await build().service.view('org-1', 'p-1', 'es');
    expect(view.steps.map((step) => step.id)).toEqual(['unposted-journal-entries', 'bank-reconciliation', 'fixed-assets-depreciation', 'pending-general-approvals']);
    expect(view.steps[0]).toMatchObject({ description: 'unposted:2', pending: 2, done: false });
    expect(view).toMatchObject({ progress: 25, ready: false, openAnomalies: { critical: 0, high: 2, medium: 0, low: 5 }, mailedBillsToReview: 3 });
  });

  it('writes the plan from exactly what the screen shows', async () => {
    const brief = await build().service.build('org-1', { sourceRunId: 'p-1', language: 'es' } as never, null);
    expect(brief.facts['canCloseNow']).toBe(false);
    expect((brief.facts['steps'] as unknown[]).length).toBe(4);
    expect(brief.requiredPermissions).toEqual(['accounting:view']);
    expect(brief.instructions).toContain('Septiembre 2026');
  });
});
