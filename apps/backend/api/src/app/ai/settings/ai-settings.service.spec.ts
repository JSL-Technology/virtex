import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiSettingsService } from './ai-settings.service';
import { AiOrganizationSettings } from '../entities/ai-organization-settings.entity';
import { AI_BUDGET_THRESHOLD } from '../../contracts/ai-insights/ai-budget.contract';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../../common/database/testing/integration-db';

/**
 * What a company decides about its AI holds on every call: switched off is off, a feature switched
 * off is off, and a spent budget stops the next call — with each threshold announced once.
 */
describeWithDb('AiSettingsService', () => {
  let dataSource: DataSource;
  let organizationId: string;
  let service: AiSettingsService;
  const events = new EventEmitter2();
  const emitted: unknown[] = [];
  events.on(AI_BUDGET_THRESHOLD, (event) => emitted.push(event));
  const config = { get: (key: string) => ({ AI_DEFAULT_MONTHLY_BUDGET_USD: 10, AI_MAX_MONTHLY_BUDGET_USD: 100 })[key] };

  const spend = (usd: number) =>
    dataSource.query(
      `INSERT INTO ai_requests (organization_id, feature, provider, model, status, credits, cost_micro_usd, latency_ms)
       VALUES ($1, 'copilot', 'anthropic', 'claude-opus-5-5', 'SUCCEEDED', 1, $2, 10)`,
      [organizationId, Math.round(usd * 1_000_000)],
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'ai-settings');
    service = new AiSettingsService(config as never, dataSource, events, dataSource.getRepository(AiOrganizationSettings));
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  it('starts from the platform defaults: on, nothing sent unasked, the default budget', async () => {
    expect(await service.get(organizationId)).toMatchObject({
      languageModels: true,
      scheduledReports: false,
      imageEmbeddings: false,
      monthlyBudgetUsd: 10,
      maskIdentifiers: true,
    });
    await expect(service.assertCallAllowed(organizationId, 'copilot')).resolves.toBeUndefined();
  });

  it('refuses a call when the company switched the AI, or that one feature, off', async () => {
    await service.update(organizationId, '00000000-0000-4000-8000-0000000000a1', { disabledFeatures: ['bill_capture'] });
    await expect(service.assertCallAllowed(organizationId, 'bill_capture')).rejects.toMatchObject({ messageKey: 'ai.feature_disabled_for_organization' });
    await expect(service.assertCallAllowed(organizationId, 'copilot')).resolves.toBeUndefined();
    await service.update(organizationId, '00000000-0000-4000-8000-0000000000a1', { languageModels: false });
    await expect(service.assertCallAllowed(organizationId, 'copilot')).rejects.toMatchObject({ messageKey: 'ai.disabled_for_organization' });
    await service.update(organizationId, '00000000-0000-4000-8000-0000000000a1', { languageModels: true, disabledFeatures: [] });
  });

  it('will not take a budget above the platform ceiling, nor a daily one above the monthly', async () => {
    await expect(service.update(organizationId, '00000000-0000-4000-8000-0000000000a1', { monthlyBudgetUsd: 1_000 })).rejects.toMatchObject({ messageKey: 'ai.settings.budget_above_ceiling' });
    await expect(service.update(organizationId, '00000000-0000-4000-8000-0000000000a1', { dailyBudgetUsd: 50 })).rejects.toMatchObject({ messageKey: 'ai.settings.daily_above_monthly' });
  });

  it('announces 50 % and 80 % once each, and stops the next call at 100 %', async () => {
    await spend(5.5);
    await service.afterCall(organizationId);
    await service.afterCall(organizationId);
    expect(emitted).toEqual([expect.objectContaining({ organizationId, percent: 50, budgetUsd: 10 })]);

    await spend(3);
    await service.afterCall(organizationId);
    expect(emitted.map((event) => (event as { percent: number }).percent)).toEqual([50, 80]);
    await expect(service.assertCallAllowed(organizationId, 'copilot')).resolves.toBeUndefined();

    await spend(2);
    await service.afterCall(organizationId);
    expect(emitted.map((event) => (event as { percent: number }).percent)).toEqual([50, 80, 100]);
    await expect(service.assertCallAllowed(organizationId, 'copilot')).rejects.toMatchObject({ messageKey: 'ai.budget_exhausted' });

    // Raising the budget lets calls through again.
    await service.update(organizationId, '00000000-0000-4000-8000-0000000000a1', { monthlyBudgetUsd: 50 });
    await expect(service.assertCallAllowed(organizationId, 'copilot')).resolves.toBeUndefined();
  });

  it('a daily budget stops the day without touching the month', async () => {
    await service.update(organizationId, '00000000-0000-4000-8000-0000000000a1', { dailyBudgetUsd: 5 });
    await expect(service.assertCallAllowed(organizationId, 'copilot')).rejects.toMatchObject({ messageKey: 'ai.daily_budget_exhausted' });
  });
});
