import { CopilotToolRegistry } from '../../contracts/copilot/copilot-tools.contract';
import { MemberAccess } from '../../roles/contracts/member-access.contract';
import { AiReport } from '../entities/ai-report.entity';
import { ManagerReportBuilder, monthBounds, previousMonth } from './manager-report.builder';

describe('the manager report', () => {
  describe('its month', () => {
    it('spans the calendar month, leap years included, and knows the one before', () => {
      expect(monthBounds('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29', previous: '2028-01' });
      expect(monthBounds('2026-01')).toEqual({ start: '2026-01-01', end: '2026-01-31', previous: '2025-12' });
      expect(() => monthBounds('2026-13x')).toThrow();
    });

    it('is the month that just ended', () => {
      expect(previousMonth(new Date('2026-10-01T06:41:00Z'))).toBe('2026-09');
      expect(previousMonth(new Date('2026-01-15T00:00:00Z'))).toBe('2025-12');
    });
  });

  describe('its facts', () => {
    const report = { id: 'rep-1', period: '2026-09', language: 'es', requestedByUserId: 'u-1' } as AiReport;
    const everything: MemberAccess = { userId: 'u-1', active: true, permissions: ['*'], branches: null, language: 'es' };

    const setup = (enabled: Record<string, boolean>, failing: string[] = []) => {
      const registry = new CopilotToolRegistry();
      const calls: Array<{ name: string; input: Record<string, unknown>; userId: string }> = [];
      for (const source of ManagerReportBuilder.SOURCES) {
        if (registry.get(source.tool)) continue;
        registry.register({
          kind: 'read',
          name: source.tool,
          description: '',
          permissions: [`${source.tool}:view`],
          // The AI's own projection is company-wide; the statements mirror their screens.
          branchScope: source.tool === 'cashflow_forecast' ? 'unscoped' : 'none',
          inputSchema: {},
          feature: source.tool === 'cashflow_forecast' ? 'ai_cashflow' : undefined,
          run: async (ctx, input) => {
            calls.push({ name: source.tool, input, userId: ctx.user.id });
            if (failing.includes(source.tool)) throw new Error('down');
            return { tool: source.tool, total: 1200.5 };
          },
        });
      }
      const entitlements = { checkFeature: jest.fn(async (_org: string, feature: string) => enabled[feature] ?? false) };
      const builder = new ManagerReportBuilder({ register: jest.fn() } as never, registry, entitlements as never);
      return { builder, calls };
    };

    it('reads the month and the month before through the domains’ own tools, as the requester', async () => {
      const { builder, calls } = setup({ ai_cashflow: true });
      const brief = await builder.build('org-1', report, everything);

      const income = calls.filter((call) => call.name === 'income_statement').map((call) => call.input);
      expect(income).toEqual([
        { start_date: '2026-09-01', end_date: '2026-09-30' },
        { start_date: '2026-08-01', end_date: '2026-08-31' },
      ]);
      expect(calls.find((call) => call.name === 'balance_sheet')?.input).toEqual({ as_of: '2026-09-30' });
      expect(new Set(calls.map((call) => call.userId))).toEqual(new Set(['u-1']));
      expect(brief.facts).toMatchObject({ period: '2026-09', cashflowProjection: { tool: 'cashflow_forecast' }, unavailable: [] });
      expect(brief.instructions).toContain('2026-09');
    });

    it('says what it could not see: a feature the plan lacks, a tool that failed', async () => {
      const { builder, calls } = setup({ ai_cashflow: false }, ['payables_aging']);
      const brief = await builder.build('org-1', report, everything);
      expect(calls.some((call) => call.name === 'cashflow_forecast')).toBe(false);
      expect(brief.facts['unavailable']).toEqual(expect.arrayContaining(['cashflowProjection', 'payables']));
      expect(brief.facts['payables']).toBeUndefined();
    });

    it('refuses to write a month it could not read at all', async () => {
      const { builder } = setup({}, ['income_statement', 'sales_trend']);
      await expect(builder.build('org-1', report, everything)).rejects.toThrow(/income statement/);
    });

    it('runs the scheduled report as no one: the whole company', async () => {
      const { builder, calls } = setup({});
      await builder.build('org-1', { ...report, requestedByUserId: null } as AiReport, null);
      expect(new Set(calls.map((call) => call.userId))).toEqual(new Set(['']));
    });

    it('reads nothing the requester could not open themselves, and records what it did read', async () => {
      const { builder, calls } = setup({ ai_cashflow: true });
      const accountant: MemberAccess = {
        userId: 'u-1',
        active: true,
        permissions: ['income_statement:view', 'sales_trend:view'],
        branches: null,
        language: 'es',
      };
      const brief = await builder.build('org-1', report, accountant);
      expect(new Set(calls.map((call) => call.name))).toEqual(new Set(['income_statement', 'sales_trend']));
      expect(brief.facts['balanceSheet']).toBeUndefined();
      expect(brief.facts['receivables']).toBeUndefined();
      expect(brief.facts['unavailable']).toEqual(expect.arrayContaining(['balanceSheet', 'receivables', 'payables', 'cashPosition']));
      expect(new Set(brief.requiredPermissions)).toEqual(new Set(['income_statement:view', 'sales_trend:view']));
    });

    it('gives a person limited to branches none of the company-wide projections', async () => {
      const { builder, calls } = setup({ ai_cashflow: true });
      const cashier: MemberAccess = { userId: 'u-1', active: true, permissions: ['*'], branches: ['br-1'], language: 'es' };
      const brief = await builder.build('org-1', report, cashier);
      expect(calls.some((call) => call.name === 'cashflow_forecast')).toBe(false);
      expect(brief.facts['unavailable']).toContain('cashflowProjection');
    });
  });
});
