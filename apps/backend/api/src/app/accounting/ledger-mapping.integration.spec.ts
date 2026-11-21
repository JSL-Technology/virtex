import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LedgerMappingService } from './ledger-mapping.service';
import { LedgerMappingRule } from './entities/ledger-mapping-rule.entity';
import { Ledger } from './entities/ledger.entity';
import { CreateOrUpdateLedgerMapDto } from './dto/ledger-mapping.dto';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * The rules that carry a line's amount from one ledger to another — a local-GAAP book from the IFRS
 * one — name the company's own accounts, each source once, with a factor the ledger can record
 * (FIN-AC-05).
 *
 * They were inserted as sent: an account of another company stopped only at the database's
 * same-tenant guard as a bare foreign-key violation, a source named twice at the unique index as a
 * bare conflict — neither saying which rule — and a negative factor was stored, to make every later
 * posting on the account fail against the valuations' sign check.
 */
describeWithDb('ledger mapping rules (FIN-AC-05)', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let organizationId: string;
  let otherOrganizationId: string;
  let service: LedgerMappingService;
  let ifrs: string;
  let local: string;
  const account: Record<string, string> = {};

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'ledger-mapping');
    otherOrganizationId = await createTestOrganization(ds, 'ledger-mapping-other');
    const insert = async (orgId: string, code: string) =>
      (
        await ds.query(
          `INSERT INTO accounts (organization_id, code, name, type, category, nature, "isPostable", version)
           VALUES ($1, $2, '{"es":"Cuenta"}'::jsonb, 'EXPENSE', 'OPERATING_EXPENSE', 'DEBIT', true, 1) RETURNING id`,
          [orgId, code],
        )
      )[0].id as string;
    account['rent'] = await insert(organizationId, '6100');
    account['fees'] = await insert(organizationId, '6200');
    account['foreign'] = await insert(otherOrganizationId, '6100');
    [{ id: ifrs }] = await ds.query(`INSERT INTO ledgers (organization_id, name, currency, is_default) VALUES ($1, 'NIIF', 'DOP', true) RETURNING id`, [
      organizationId,
    ]);
    [{ id: local }] = await ds.query(`INSERT INTO ledgers (organization_id, name, currency) VALUES ($1, 'Local', 'DOP') RETURNING id`, [organizationId]);
    service = new LedgerMappingService(ds.getRepository(LedgerMappingRule), ds.getRepository(Ledger), ds);
  });

  afterAll(async () => {
    if (ds?.isInitialized && otherOrganizationId) await ds.query(`DELETE FROM organizations WHERE id = $1`, [otherOrganizationId]);
    await dropTestOrganization(ds, organizationId);
  });

  const map = (mappings: Array<{ sourceAccountId: string; parentAccountId: string; multiplier?: number }>, target = local) =>
    service.createOrUpdateMap({ sourceLedgerId: ifrs, targetLedgerId: target, mappings } as CreateOrUpdateLedgerMapDto, organizationId);

  it('stores rules over the company’s own accounts', async () => {
    await expect(
      map([
        { sourceAccountId: account['rent'], parentAccountId: account['rent'], multiplier: 1 },
        { sourceAccountId: account['fees'], parentAccountId: account['fees'], multiplier: 0.5 },
      ]),
    ).resolves.toMatchObject({ created: 2 });
  });

  it('refuses an account of another company, naming the rule, and keeps the rules there were', async () => {
    await expect(
      map([
        { sourceAccountId: account['rent'], parentAccountId: account['rent'] },
        { sourceAccountId: account['foreign'], parentAccountId: account['rent'] },
      ]),
    ).rejects.toMatchObject({ messageKey: 'accounting.ledger_mapping_account_not_found', params: { line: 2 } });
    // Checked before the existing rules are replaced, in the same transaction.
    expect(await service.getMapForLedgerPair(ifrs, local, organizationId)).toHaveLength(2);
  });

  it('refuses a source account named twice, and a ledger mapped onto itself', async () => {
    await expect(
      map([
        { sourceAccountId: account['rent'], parentAccountId: account['rent'] },
        { sourceAccountId: account['rent'], parentAccountId: account['fees'] },
      ]),
    ).rejects.toMatchObject({ messageKey: 'accounting.ledger_mapping_source_repeated', params: { line: 2, first: 1 } });
    await expect(map([{ sourceAccountId: account['rent'], parentAccountId: account['rent'] }], ifrs)).rejects.toMatchObject({
      messageKey: 'accounting.ledger_mapping_same_ledger',
    });
  });

  it('accepts only a factor the target ledger can record', async () => {
    const errorsFor = async (multiplier: unknown) =>
      (
        await validate(
          plainToInstance(CreateOrUpdateLedgerMapDto, {
            sourceLedgerId: ifrs,
            targetLedgerId: local,
            mappings: [{ sourceAccountId: account['rent'], parentAccountId: account['rent'], multiplier }],
          }),
        )
      ).length;
    expect(await errorsFor(-1)).toBeGreaterThan(0);
    expect(await errorsFor(0)).toBeGreaterThan(0);
    expect(await errorsFor(1.25)).toBe(0);
  });
});
