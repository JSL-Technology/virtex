import { UsageMetricRepository } from './usage-metric.repository';
import { SaasResource } from '../enums/saas-resource.enum';

/** What TypeORM's Postgres driver hands back from `manager.query`, by statement. */
const UPDATE = <T>(rows: T[]) => [rows, rows.length] as const;
const INSERT = <T>(rows: T[]) => rows;

/**
 * The plan quota, against the driver's real result shapes.
 *
 * An UPDATE that matched nothing returned `[[], 0]`, whose `[0]` — an empty array — is truthy: the
 * row was never inserted, the count came back `undefined`, and the first metered call cached
 * «limit reached» for five minutes. A company's first invoice issued; its second was refused.
 */
describe('UsageMetricRepository.incrementUsage', () => {
  const repository = new UsageMetricRepository();

  it('inserts the first unit of a period when the update matched nothing', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(UPDATE([]))
      .mockResolvedValueOnce(INSERT([{ count: 1 }]));
    const result = await repository.incrementUsage({ query } as never, 'org', SaasResource.INVOICES, '2026-10', 1, 10, false);
    expect(result).toEqual({ count: 1, limitReached: false });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reads the new count of an existing period as a number', async () => {
    const query = jest.fn().mockResolvedValueOnce(UPDATE([{ count: '4' }]));
    const result = await repository.incrementUsage({ query } as never, 'org', SaasResource.INVOICES, '2026-10', 1, 10, false);
    expect(result).toEqual({ count: 4, limitReached: false });
  });
});
