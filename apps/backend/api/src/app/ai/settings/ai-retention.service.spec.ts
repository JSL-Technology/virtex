import { DataSource } from 'typeorm';
import { AiRetentionService } from './ai-retention.service';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  newId,
  openTestDataSource,
} from '../../common/database/testing/integration-db';

/** Conversations go when the company said they go; what the AI proposed stays. */
describeWithDb('AiRetentionService', () => {
  let dataSource: DataSource;
  let organizationId: string;
  let userId: string;
  let service: AiRetentionService;

  const conversation = async (daysAgo: number, owner = userId) => {
    const id = await newId(dataSource);
    await dataSource.query(
      `INSERT INTO ai_conversations (id, organization_id, user_id, title, updated_at) VALUES ($1, $2, $3, 't', now() - make_interval(days => $4::int))`,
      [id, organizationId, owner, daysAgo],
    );
    return id;
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'ai-retention');
    userId = await newId(dataSource);
    await dataSource.query(`INSERT INTO users (id, email, "firstName", "lastName", status) VALUES ($1, $2, 'R', 'T', 'ACTIVE')`, [
      userId,
      `retention-${userId}@virtex.test`,
    ]);
    await dataSource.query(`INSERT INTO user_organizations (user_id, organization_id) VALUES ($1, $2)`, [userId, organizationId]);
    const settings = { get: async () => ({ conversationRetentionDays: 30 }) };
    service = new AiRetentionService(dataSource, settings as never, {} as never);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM user_organizations WHERE user_id = $1`, [userId]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await dropTestOrganization(dataSource, organizationId);
  });

  it('deletes what is past the retention period and what belongs to someone who left; keeps the proposals', async () => {
    const recent = await conversation(5);
    const old = await conversation(45);
    const formerMember = await conversation(1, await newId(dataSource));
    await dataSource.query(
      `INSERT INTO ai_pending_actions (organization_id, conversation_id, user_id, tool, input, summary, preview, status)
       VALUES ($1, $2, $3, 'draft_quote', '{}', 's', '{}', 'CONFIRMED')`,
      [organizationId, old, userId],
    );

    expect(await service.purge(organizationId)).toBe(2);
    const left: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ai_conversations WHERE organization_id = $1`, [organizationId]);
    expect(left.map((row) => row.id)).toEqual([recent]);
    expect(left.map((row) => row.id)).not.toContain(formerMember);
    const proposals: Array<{ conversation_id: string | null; status: string }> = await dataSource.query(
      `SELECT conversation_id, status FROM ai_pending_actions WHERE organization_id = $1`,
      [organizationId],
    );
    expect(proposals).toEqual([{ conversation_id: null, status: 'CONFIRMED' }]);
  });
});
