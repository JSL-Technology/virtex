import { AiNotificationsListener } from './ai-notifications.listener';

/**
 * The bell, told what the AI found: stockouts to those who can read forecasts, anomalies to those
 * who can read anomalies — and nobody else.
 */
describe('AiNotificationsListener', () => {
  const members = [
    { id: 'u-buyer', language: 'es', permissions: 'ai_forecasts:view' },
    { id: 'u-auditor', language: 'en', permissions: 'ai_anomalies:view' },
    { id: 'u-sales', language: 'es', permissions: 'invoices:view' },
  ];

  const build = () => {
    const runner = { connect: jest.fn(), query: jest.fn(async () => undefined), release: jest.fn(async () => undefined) };
    const dataSource = {
      createQueryRunner: () => runner,
      createEntityManager: () => ({}),
      query: jest.fn(async () => members),
    };
    const notifications = { createLocalizedNotification: jest.fn(async () => ({})) };
    const listener = new AiNotificationsListener(notifications as never, dataSource as never);
    return { listener, notifications, runner };
  };

  it('tells the people who read forecasts which products are about to run out', async () => {
    const { listener, notifications, runner } = build();
    await listener.onFindings({
      organizationId: 'org-1',
      runId: 'r1',
      kind: 'FORECAST',
      stockouts: { count: 4, earliestDate: '2026-11-05', products: ['Arroz', 'Aceite'] },
    });
    expect(notifications.createLocalizedNotification).toHaveBeenCalledTimes(1);
    expect(notifications.createLocalizedNotification).toHaveBeenCalledWith('u-buyer', 'es', {
      titleKey: 'notifications.ai.stockouts.title',
      bodyKey: 'notifications.ai.stockouts.body',
      params: { count: 4, products: 'Arroz, Aceite', date: expect.stringContaining('noviembre') },
      link: '/inventory/predictions',
      organizationId: 'org-1',
    });
    // It acted as the tenant, and gave the connection back clean.
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('set_config'), ['org-1']);
    expect(runner.query).toHaveBeenCalledWith('RESET app.current_organization');
  });

  it('tells the people who read anomalies, flagging the critical ones in the title', async () => {
    const { listener, notifications } = build();
    await listener.onFindings({ organizationId: 'org-1', runId: 'r2', kind: 'ANOMALY', anomalies: { count: 3, critical: 1 } });
    expect(notifications.createLocalizedNotification).toHaveBeenCalledTimes(1);
    expect(notifications.createLocalizedNotification).toHaveBeenCalledWith(
      'u-auditor',
      'en',
      expect.objectContaining({
        titleKey: 'notifications.ai.anomalies.title_critical',
        bodyKey: 'notifications.ai.anomalies.body',
        link: '/reports/anomalies',
      }),
    );
  });

  it('a failure to notify is swallowed: the run already happened', async () => {
    const { listener, notifications } = build();
    notifications.createLocalizedNotification.mockRejectedValueOnce(new Error('push down'));
    await expect(
      listener.onFindings({ organizationId: 'org-1', runId: 'r3', kind: 'ANOMALY', anomalies: { count: 1, critical: 0 } }),
    ).resolves.toBeUndefined();
  });
});
