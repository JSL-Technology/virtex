import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowsService, ApprovalActor } from './workflows.service';
import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { ApprovalPolicy, DocumentTypeForApproval } from './entities/approval-policy.entity';
import { ApprovalPolicyStep } from './entities/approval-policy-step.entity';
import { ApprovalRequest, ApprovalStatus } from './entities/approval-request.entity';
import { ApprovalStepAction } from './entities/approval-step-action.entity';
import { JournalEntry, JournalEntryStatus } from '../journal-entries/entities/journal-entry.entity';
import { JournalEntryAttachment } from '../journal-entries/entities/journal-entry-attachment.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryApprovalHandler } from '../journal-entries/journal-entry-approval.handler';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';

/**
 * The approval chain, end to end, against a real database.
 *
 * ## Why this suite exists
 *
 * The feature was completely broken and every existing test hid it. `ledger-integrity.spec.ts`,
 * `accounts-payable.spec.ts`, `treasury.spec.ts` and the rest all stub `startApprovalProcess` to
 * return `null` — "no policy applies" — because they are testing posting, not approval. So the
 * only path anyone exercised was the one that skips approval entirely, and the path that a tenant
 * with a policy actually takes had never run: `WorkflowsService.approve` marked the request
 * APPROVED and returned, while the two listeners meant to post the document waited on
 * `approval.request.approved`, an event no code emitted.
 *
 * Nothing here is stubbed. A real policy, a real request, a real decision, and the entry is looked
 * up in the ledger afterwards.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

const ORG = '9b000000-0000-4000-8000-000000000001';
const LEDGER = '9b000000-0000-4000-8000-000000000002';
const JOURNAL = '9b000000-0000-4000-8000-000000000003';
const CASH = '9b000000-0000-4000-8000-000000000004';
const REVENUE = '9b000000-0000-4000-8000-000000000005';
const POLICY = '9b000000-0000-4000-8000-000000000006';
const ROLE_ACCOUNTANT = '9b000000-0000-4000-8000-000000000007';
const ROLE_CFO = '9b000000-0000-4000-8000-000000000008';
const PERIOD = '9b000000-0000-4000-8000-000000000009';

const SUBMITTER = '9b000000-0000-4000-8000-00000000000a';
const ACCOUNTANT = '9b000000-0000-4000-8000-00000000000b';
const CFO = '9b000000-0000-4000-8000-00000000000c';
const OUTSIDER = '9b000000-0000-4000-8000-00000000000d';
const OTHER_ORG = '9b000000-0000-4000-8000-00000000000e';

describeWithDb('approval flow', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let workflows: WorkflowsService;
  let entries: JournalEntriesService;
  let registry: ApprovalHandlerRegistry;

  const actor = (userId: string, roleIds: string[], organizationId = ORG): ApprovalActor => ({
    userId,
    organizationId,
    roleIds,
  });

  const accountant = () => actor(ACCOUNTANT, [ROLE_ACCOUNTANT]);
  const cfo = () => actor(CFO, [ROLE_CFO]);

  /** Compose an entry through the real service, which routes it into the real policy. */
  const submit = (amount: number) =>
    entries.create(
      {
        date: '2026-03-10',
        description: `Asiento de ${amount}`,
        journalId: JOURNAL,
        lines: [
          { accountId: CASH, debit: amount, credit: 0 },
          { accountId: REVENUE, debit: 0, credit: amount },
        ],
      },
      ORG,
      { actorUserId: SUBMITTER },
    );

  const requestFor = async (documentId: string): Promise<ApprovalRequest> => {
    const request = await dataSource.manager.findOneOrFail(ApprovalRequest, {
      where: { organizationId: ORG, documentId },
    });
    return request;
  };

  const setPolicySteps = async (steps: { order: number; minAmount: number; roleId: string }[]) => {
    await dataSource.manager.delete(ApprovalPolicyStep, { policyId: POLICY });
    for (const step of steps) {
      await dataSource.manager.save(
        dataSource.manager.create(ApprovalPolicyStep, { ...step, policyId: POLICY }),
      );
    }
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();

    for (const org of [ORG, OTHER_ORG]) {
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [org]);
    }
    await dataSource.query(
      `INSERT INTO organizations (id, legal_name) VALUES ($1, 'Aprobaciones S.R.L.'), ($2, 'Ajena S.A.')`,
      [ORG, OTHER_ORG],
    );
    await dataSource.query(
      `INSERT INTO ledgers (id, organization_id, name, currency, is_default)
       VALUES ($1, $2, 'Principal', 'USD', true)`,
      [LEDGER, ORG],
    );
    await dataSource.query(
      `INSERT INTO journals (id, organization_id, code, name, type)
       VALUES ($1, $2, 'GEN', 'General', 'GENERAL')`,
      [JOURNAL, ORG],
    );
    await dataSource.query(
      `INSERT INTO accounts
         (id, organization_id, code, name, type, category, nature, version, "isPostable")
       VALUES
         ($1, $3, '1000', '{"es":"Caja"}', 'ASSET', 'CURRENT_ASSET', 'DEBIT', 1, true),
         ($2, $3, '4000', '{"es":"Ventas"}', 'REVENUE', 'OPERATING_REVENUE', 'CREDIT', 1, true)`,
      [CASH, REVENUE, ORG],
    );
    await dataSource.query(
      `INSERT INTO accounting_periods (id, organization_id, name, start_date, end_date, status)
       VALUES ($1, $2, 'Marzo 2026', '2026-03-01', '2026-03-31', 'OPEN')`,
      [PERIOD, ORG],
    );
    await dataSource.query(
      `INSERT INTO organization_settings (organization_id, base_currency) VALUES ($1, 'USD')`,
      [ORG],
    );

    await dataSource.manager.save(
      dataSource.manager.create(ApprovalPolicy, {
        id: POLICY,
        organizationId: ORG,
        name: 'Asientos manuales',
        documentType: DocumentTypeForApproval.JOURNAL_ENTRY,
      }),
    );

    const audit = new AuditTrailService(dataSource.getRepository(AuditLog));
    registry = new ApprovalHandlerRegistry();
    workflows = new WorkflowsService(
      dataSource.getRepository(ApprovalPolicy),
      dataSource.getRepository(ApprovalRequest),
      registry,
      audit,
      dataSource,
    );
    entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      workflows,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      audit,
      new ExchangeRateResolver(dataSource),
    );
    // The real handler, registered exactly as the module does it.
    new JournalEntryApprovalHandler(entries, registry).onModuleInit();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      for (const org of [ORG, OTHER_ORG]) {
        await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [org]);
      }
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await setPolicySteps([{ order: 1, minAmount: 0, roleId: ROLE_ACCOUNTANT }]);
  });

  // ───────────────────────────────────────────────────────────────────────────

  describe('the document actually posts', () => {
    /**
     * The headline failure: this could not have passed before, at any amount, in any tenant.
     */
    it('posts the entry to the ledger when the approval is granted', async () => {
      const draft = await submit(500);
      expect(draft.status).toBe(JournalEntryStatus.PENDING_APPROVAL);
      expect(draft.entryNumber).toBeNull();

      const request = await requestFor(draft.id);
      const decided = await workflows.approve(request.id, accountant());

      expect(decided.status).toBe(ApprovalStatus.APPROVED);

      const posted = await dataSource.manager.findOneOrFail(JournalEntry, {
        where: { id: draft.id },
      });
      expect(posted.status).toBe(JournalEntryStatus.POSTED);
      expect(posted.entryNumber).toMatch(/^GEN-2026-\d{6}$/);
      expect(posted.postedByUserId).toBe(ACCOUNTANT);
      expect(posted.postedAt).toBeInstanceOf(Date);
    });

    it('leaves the entry unposted, and rejected, when the approval is refused', async () => {
      const draft = await submit(600);
      const request = await requestFor(draft.id);

      await workflows.reject(request.id, accountant(), 'Sin soporte documental');

      const after = await dataSource.manager.findOneOrFail(JournalEntry, {
        where: { id: draft.id },
      });
      expect(after.status).toBe(JournalEntryStatus.REJECTED);
      expect(after.entryNumber).toBeNull();
      expect(after.modificationReason).toBe('Sin soporte documental');
    });

    /**
     * The posting shares the approval's transaction, so a posting that cannot happen takes the
     * approval down with it rather than leaving a granted approval and no ledger row.
     */
    it('rolls the approval back when the posting fails', async () => {
      const draft = await submit(700);
      const request = await requestFor(draft.id);

      await dataSource.query(
        `UPDATE accounting_periods SET status = 'CLOSED', gl_status = 'CLOSED' WHERE id = $1`,
        [PERIOD],
      );
      try {
        await expect(workflows.approve(request.id, accountant())).rejects.toThrow();

        const stillPending = await dataSource.manager.findOneOrFail(ApprovalRequest, {
          where: { id: request.id },
        });
        expect(stillPending.status).toBe(ApprovalStatus.PENDING);

        const entry = await dataSource.manager.findOneOrFail(JournalEntry, {
          where: { id: draft.id },
        });
        expect(entry.status).toBe(JournalEntryStatus.PENDING_APPROVAL);
      } finally {
        await dataSource.query(
          `UPDATE accounting_periods SET status = 'OPEN', gl_status = 'OPEN' WHERE id = $1`,
          [PERIOD],
        );
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────

  describe('segregation of duties', () => {
    it('refuses to let the submitter approve their own request', async () => {
      const draft = await submit(800);
      const request = await requestFor(draft.id);

      await expect(
        workflows.approve(request.id, actor(SUBMITTER, [ROLE_ACCOUNTANT])),
      ).rejects.toThrow();

      const entry = await dataSource.manager.findOneOrFail(JournalEntry, {
        where: { id: draft.id },
      });
      expect(entry.status).toBe(JournalEntryStatus.PENDING_APPROVAL);
    });

    it('records who raised the request', async () => {
      const draft = await submit(900);
      const request = await requestFor(draft.id);
      expect(request.requestedByUserId).toBe(SUBMITTER);
      expect(Number(request.amount)).toBe(900);
    });

    it('refuses a decision from someone without the step role', async () => {
      const draft = await submit(1000);
      const request = await requestFor(draft.id);
      await expect(workflows.approve(request.id, actor(OUTSIDER, []))).rejects.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    /**
     * The exploit: `findOneBy({ id: requestId })` with no `organizationId`, on a route with no
     * permission. Any authenticated user of any tenant could refuse another customer's documents.
     */
    it('refuses to approve a request belonging to another tenant', async () => {
      const draft = await submit(1100);
      const request = await requestFor(draft.id);

      await expect(
        workflows.approve(request.id, actor(ACCOUNTANT, [ROLE_ACCOUNTANT], OTHER_ORG)),
      ).rejects.toThrow();
    });

    it('refuses to reject a request belonging to another tenant', async () => {
      const draft = await submit(1200);
      const request = await requestFor(draft.id);

      await expect(
        workflows.reject(request.id, actor(ACCOUNTANT, [ROLE_ACCOUNTANT], OTHER_ORG), 'no'),
      ).rejects.toThrow();

      const untouched = await dataSource.manager.findOneOrFail(ApprovalRequest, {
        where: { id: request.id },
      });
      expect(untouched.status).toBe(ApprovalStatus.PENDING);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────

  describe('multi-step chains', () => {
    beforeEach(async () => {
      await setPolicySteps([
        { order: 1, minAmount: 0, roleId: ROLE_ACCOUNTANT },
        { order: 2, minAmount: 5000, roleId: ROLE_CFO },
      ]);
    });

    it('escalates to the second step and posts only after the last one', async () => {
      const draft = await submit(9000);
      const request = await requestFor(draft.id);

      const afterFirst = await workflows.approve(request.id, accountant());
      expect(afterFirst.status).toBe(ApprovalStatus.PENDING);
      expect(afterFirst.currentStep).toBe(2);

      const midway = await dataSource.manager.findOneOrFail(JournalEntry, {
        where: { id: draft.id },
      });
      expect(midway.status).toBe(JournalEntryStatus.PENDING_APPROVAL);

      const afterSecond = await workflows.approve(request.id, cfo());
      expect(afterSecond.status).toBe(ApprovalStatus.APPROVED);

      const posted = await dataSource.manager.findOneOrFail(JournalEntry, {
        where: { id: draft.id },
      });
      expect(posted.status).toBe(JournalEntryStatus.POSTED);
    });

    /** The step whose threshold is not met does not apply, so one approval is enough. */
    it('skips a step whose threshold the amount does not reach', async () => {
      const draft = await submit(1000);
      const request = await requestFor(draft.id);

      const decided = await workflows.approve(request.id, accountant());
      expect(decided.status).toBe(ApprovalStatus.APPROVED);
    });

    /**
     * Every approver, not just the last one. The request carried a single `approvedByUserId`
     * written only on the final step, so an intermediate approval left no trace of any kind.
     */
    it('records a row per decision, with actor, step and timestamp', async () => {
      const draft = await submit(9500);
      const request = await requestFor(draft.id);

      await workflows.approve(request.id, accountant(), 'Revisado');
      await workflows.approve(request.id, cfo(), 'Autorizado');

      const history = await workflows.historyFor(request.id, ORG);
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        stepOrder: 1,
        actorUserId: ACCOUNTANT,
        decision: 'APPROVED',
        comment: 'Revisado',
      });
      expect(history[1]).toMatchObject({
        stepOrder: 2,
        actorUserId: CFO,
        decision: 'APPROVED',
        comment: 'Autorizado',
      });
    });

    it('records the rejection with its author and reason', async () => {
      const draft = await submit(9600);
      const request = await requestFor(draft.id);

      await workflows.reject(request.id, accountant(), 'Falta cotización');

      const stored = await dataSource.manager.findOneOrFail(ApprovalRequest, {
        where: { id: request.id },
      });
      expect(stored.rejectedByUserId).toBe(ACCOUNTANT);
      expect(stored.rejectedAt).toBeInstanceOf(Date);

      const history = await dataSource.manager.find(ApprovalStepAction, {
        where: { requestId: request.id },
      });
      expect(history).toHaveLength(1);
      expect(history[0].decision).toBe('REJECTED');
    });

    it('refuses a second decision on a request already resolved', async () => {
      const draft = await submit(1300);
      const request = await requestFor(draft.id);
      await workflows.approve(request.id, accountant());
      await expect(workflows.approve(request.id, cfo())).rejects.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────

  describe('no policy', () => {
    it('posts directly when no step applies to the amount', async () => {
      await setPolicySteps([{ order: 1, minAmount: 100000, roleId: ROLE_ACCOUNTANT }]);
      const entry = await submit(50);
      expect(entry.status).toBe(JournalEntryStatus.POSTED);
      expect(entry.entryNumber).toBeTruthy();
    });
  });

  describe('a document type with no handler', () => {
    /**
     * Refusing the approval is the right outcome: granting one that will never take effect is how
     * the product ended up with approved documents and an empty ledger.
     */
    it('refuses the final approval rather than granting one that does nothing', async () => {
      const orphan = await dataSource.manager.save(
        dataSource.manager.create(ApprovalRequest, {
          organizationId: ORG,
          documentId: '9b000000-0000-4000-8000-0000000000ff',
          documentType: DocumentTypeForApproval.PERIOD_REOPENING,
          policyId: POLICY,
          status: ApprovalStatus.PENDING,
          currentStep: 1,
          requestedByUserId: SUBMITTER,
          amount: 0,
        }),
      );

      await expect(workflows.approve(orphan.id, accountant())).rejects.toThrow();

      const unchanged = await dataSource.manager.findOneOrFail(ApprovalRequest, {
        where: { id: orphan.id },
      });
      expect(unchanged.status).toBe(ApprovalStatus.PENDING);
    });
  });
});
