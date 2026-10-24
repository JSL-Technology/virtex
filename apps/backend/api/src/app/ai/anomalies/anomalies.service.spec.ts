import { AnomaliesService, AnomalyReader, withoutPeople } from './anomalies.service';

/** Who may see a finding, and who may decide on it. */
function build(anomaly: Record<string, unknown> | null, actors: string[] = []) {
  const repo = { findOne: jest.fn().mockResolvedValue(anomaly), save: jest.fn(async (row) => row) };
  const query = jest.fn().mockResolvedValue([]);
  const audit = { actorsOf: jest.fn().mockResolvedValue(actors) };
  const service = new AnomaliesService(repo as never, {} as never, { query } as never, {} as never, audit as never);
  return { service, repo, query, audit };
}

const everyone: AnomalyReader = { id: 'u-1', branches: null, seesSecurity: true };
const finding = { id: 'a-1', category: 'purchases', branchId: 'b-1', entityType: 'vendor_bill', entityId: 'bill-1', status: 'OPEN' };

describe('AnomaliesService', () => {
  it('keeps a branch-limited reader without the security permission to their branches and off security findings', async () => {
    const { service, query } = build(null);
    await service.list('org-1', {}, { id: 'u-1', branches: ['b-1'], seesSecurity: false });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(`"category" <> 'security'`);
    expect(sql).toContain('"branch_id" = ANY($2::uuid[])');
    expect(params).toEqual(['org-1', ['b-1']]);
  });

  it('adds no condition for someone who sees everything', async () => {
    const { service, query } = build(null);
    await service.list('org-1', {}, everyone);
    expect(query.mock.calls[0][0]).not.toContain('branch_id" = ANY');
    expect(query.mock.calls[0][1]).toEqual(['org-1']);
  });

  it('hides a finding outside the reader\'s branches as if it did not exist', async () => {
    const { service } = build(finding);
    await expect(service.reopen('org-1', { id: 'u-1', branches: ['b-2'], seesSecurity: true }, 'a-1')).rejects.toMatchObject({
      messageKey: 'ai.anomaly_not_found',
    });
  });

  it('hides a security finding from someone without the permission', async () => {
    const { service } = build({ ...finding, category: 'security' });
    await expect(service.reopen('org-1', { ...everyone, seesSecurity: false }, 'a-1')).rejects.toMatchObject({
      messageKey: 'ai.anomaly_not_found',
    });
  });

  it('refuses a decision on a finding about a record the person created or changed', async () => {
    const { service, audit } = build(finding, ['u-1']);
    await expect(service.reopen('org-1', everyone, 'a-1')).rejects.toMatchObject({
      messageKey: 'ai.anomaly_own_entry',
    });
    expect(audit.actorsOf).toHaveBeenCalledWith('org-1', 'bill-1');
  });

  it('refuses a decision on a finding about the person themselves', async () => {
    const { service } = build({ ...finding, category: 'security', entityType: 'user', entityId: 'u-1' });
    await expect(service.reopen('org-1', everyone, 'a-1')).rejects.toMatchObject({
      messageKey: 'ai.anomaly_own_entry',
    });
  });

  it('lets someone else decide', async () => {
    const { service, repo } = build({ ...finding, status: 'DISMISSED' }, ['u-2']);
    await service.reopen('org-1', everyone, 'a-1');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'OPEN' }));
  });
});

describe('withoutPeople', () => {
  it('drops the identifiers of people from the evidence and keeps the rest', () => {
    expect(withoutPeople({ userId: 'u-1', created_by: 'u-2', actor: 'x', amount: 10, vendorId: 'v-1' })).toEqual({ amount: 10, vendorId: 'v-1' });
  });
});
