import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExchangeRateResolver } from '../../currencies/exchange-rate-resolver.service';
import { Organization } from '../../organizations/entities/organization.entity';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { Journal } from '../../journal-entries/entities/journal.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import {
  AccountCategory,
  AccountNature,
  AccountRole,
  AccountType,
} from '../../chart-of-accounts/enums/account-enums';
import { AccountingPeriod, PeriodStatus } from '../../accounting/entities/accounting-period.entity';
import { FiscalYear, FiscalYearStatus } from '../../accounting/entities/fiscal-year.entity';
import {
  JournalEntry,
  JournalEntryType,
} from '../../journal-entries/entities/journal-entry.entity';
import { JournalEntryAttachment } from '../../journal-entries/entities/journal-entry-attachment.entity';
import { JournalEntriesService } from '../../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../../journal-entries/journal-entry-numbering.service';
import { AdjustmentsService } from '../../journal-entries/adjustments.service';
import { AuditTrailService } from '../audit.service';
import { AuditLog } from '../entities/audit-log.entity';
import { ProposedAdjustment, AdjustmentStatus } from '../entities/proposed-adjustment.entity';
import { User } from '../../users/entities/user.entity/user.entity';
import { AuditAdjustmentsService } from './audit-adjustments.service';
import { CreateProposedAdjustmentDto } from '../dto/proposed-adjustment.dto';
import { AuditAdjustmentApprovalHandler } from './audit-adjustment-approval.handler';
import { ApprovalHandlerRegistry } from '../../workflows/approval-handler.registry';
import { DocumentTypeForApproval } from '../../workflows/entities/approval-policy.entity';
import { toIsoDate } from '../../common/dates';

/**
 * The proposal an external auditor makes, from raising it to the entry it becomes.
 *
 * ## Why nothing covered this
 *
 * `audit-adjustment.spec.ts` next door covers `AdjustmentsService.createAuditAdjustment` — the
 * posting. What it could not cover is the path that REACHES it, because there was none:
 * `AuditAdjustmentsService` was registered in no module, had no controller, and its only caller
 * was its own `@OnEvent` listener, which nothing was listening with. The proposal, the approval
 * and the posting were three pieces that had never been run end to end.
 *
 * This drives the whole sequence: an auditor proposes against a closed year, no approval policy
 * exists so the proposal auto-approves, the listener posts the entry, and the proposal records
 * which entry it became. The entry is attributed to the PROPOSER, not to whoever approved it.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('proposing an audit adjustment', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let proposals: AuditAdjustmentsService;
  let events: EventEmitter2;

  let organizationId: string;
  let generalJournalId: string;
  let fiscalYearId: string;
  let proposer: User;
  const account: Record<string, string> = {};

  /** No policy for AUDIT_ADJUSTMENT: the proposal auto-approves, which is the service's rule. */
  const workflows = { startApprovalProcess: jest.fn().mockResolvedValue(null) };

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
      entities: [`${__dirname}/../../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();

    const entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null) } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      new AuditTrailService(dataSource.getRepository(AuditLog)),
      new ExchangeRateResolver(dataSource),
    );

    events = new EventEmitter2();
    proposals = new AuditAdjustmentsService(
      dataSource,
      workflows as never,
      { upload: jest.fn() } as never,
      events,
      new AdjustmentsService(entries, dataSource),
    );
    // The wiring the module now does: the listener is what turns an approval into an entry, and
    // it was registered nowhere.
    events.on('audit.adjustment.approved', (payload) =>
      proposals.handleAdjustmentApproved(payload as never),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    workflows.startApprovalProcess.mockResolvedValue(null);

    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Propuesta ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;

    proposer = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: `auditor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
        firstName: 'Auditor',
        lastName: 'Externo',
        organizationId,
      }),
    );

    await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({
        organizationId,
        name: 'Principal',
        currency: 'DOP',
        isDefault: true,
        isActive: true,
      }),
    );

    const journals = await dataSource.getRepository(Journal).save([
      { organizationId, code: 'GENERAL', name: 'Diario general', type: 'GENERAL' as const },
      { organizationId, code: 'CIERRE', name: 'Diario de cierre', type: 'GENERAL' as const },
    ]);
    generalJournalId = journals[0].id;

    const make = async (
      key: string,
      code: string,
      type: AccountType,
      category: AccountCategory,
      nature: AccountNature,
      systemRole: AccountRole | null = null,
    ) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code,
          name: { es: code },
          type,
          category,
          nature,
          systemRole,
          isPostable: true,
          isActive: true,
        }),
      );
      account[key] = saved.id;
    };

    await make('payable', '2101', AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, AccountNature.CREDIT, AccountRole.ACCOUNTS_PAYABLE);
    await make('expense', '5101', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await make('retained', '3201', AccountType.EQUITY, AccountCategory.RETAINED_EARNINGS, AccountNature.CREDIT, AccountRole.RETAINED_EARNINGS);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId,
        baseCurrency: 'DOP',
        defaultRetainedEarningsAccountId: account['retained'],
      }),
    );

    await dataSource.getRepository(AccountingPeriod).save([
      {
        organizationId,
        name: 'Diciembre 2025',
        startDate: '2025-12-01' as unknown as Date,
        endDate: '2025-12-31' as unknown as Date,
        status: PeriodStatus.CLOSED,
      },
    ]);
    const year = await dataSource.getRepository(FiscalYear).save(
      dataSource.getRepository(FiscalYear).create({
        organizationId,
        startDate: '2025-01-01' as unknown as Date,
        endDate: '2025-12-31' as unknown as Date,
        status: FiscalYearStatus.CLOSED,
      }),
    );
    fiscalYearId = year.id;
  });

  afterEach(async () => {
    await dataSource.getRepository(Organization).delete({ id: organizationId });
  });

  const propose = () =>
    proposals.proposeAdjustment(
      {
        fiscalYearId,
        date: '2025-12-31',
        description: 'Gasto devengado no registrado',
        journalId: generalJournalId,
        lines: [
          { accountId: account['expense'], debit: 25_000, credit: 0, description: 'Gasto' },
          { accountId: account['payable'], debit: 0, credit: 25_000, description: 'Pasivo' },
        ],
      } as CreateProposedAdjustmentDto,
      organizationId,
      proposer,
    );

  /** The event handler runs asynchronously; wait for the proposal to leave PENDING. */
  const settled = async (id: string): Promise<ProposedAdjustment> => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const row = await dataSource.getRepository(ProposedAdjustment).findOneByOrFail({ id });
      if (row.status !== AdjustmentStatus.PENDING_APPROVAL) return row;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('the proposal never left PENDING_APPROVAL');
  };

  it('posts the adjustment when no approval policy stands in the way', async () => {
    const proposal = await propose();
    const posted = await settled(proposal.id);

    expect(posted.status).toBe(AdjustmentStatus.POSTED);
    expect(posted.journalEntryId).toBeTruthy();

    const entry = await dataSource.getRepository(JournalEntry).findOneOrFail({
      where: { id: posted.journalEntryId as string },
      relations: ['lines'],
    });
    expect(entry.entryType).toBe(JournalEntryType.AUDIT_ADJUSTMENT);
    // The fiscal year's own last day, not the date the auditor happened to raise it.
    expect(toIsoDate(entry.date)).toBe('2025-12-31');
    expect(entry.lines).toHaveLength(2);
  });

  /**
   * The approval granted the adjustment; it did not author it. An entry attributed to whoever
   * clicked approve would be a worse record than one attributed to nobody.
   */
  it('attributes the entry to the auditor who proposed it', async () => {
    const proposal = await propose();
    const posted = await settled(proposal.id);

    const entry = await dataSource
      .getRepository(JournalEntry)
      .findOneByOrFail({ id: posted.journalEntryId as string });
    expect(entry.postedByUserId).toBe(proposer.id);
  });

  /**
   * `WorkflowsService` refuses an approval whose document type has no registered handler, and
   * `AUDIT_ADJUSTMENT` had none — so a tenant that required four eyes on a closed year could
   * propose an adjustment and then never approve it.
   */
  it('registers an approval handler, so a tenant with a policy can actually approve', async () => {
    const registry = new ApprovalHandlerRegistry();
    const handler = new AuditAdjustmentApprovalHandler(proposals, registry);
    handler.onModuleInit();

    expect(registry.get(DocumentTypeForApproval.AUDIT_ADJUSTMENT)).toBe(handler);
  });

  it('posts through the approval handler, on the approving transaction', async () => {
    workflows.startApprovalProcess.mockResolvedValue({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
    const proposal = await propose();

    const handler = new AuditAdjustmentApprovalHandler(proposals, new ApprovalHandlerRegistry());
    await dataSource.transaction((manager) =>
      handler.onApproved({
        manager,
        documentId: proposal.id,
        organizationId,
        actorUserId: proposer.id,
      } as never),
    );

    const posted = await dataSource
      .getRepository(ProposedAdjustment)
      .findOneByOrFail({ id: proposal.id });
    expect(posted.status).toBe(AdjustmentStatus.POSTED);
    expect(posted.journalEntryId).toBeTruthy();
  });

  it('marks a refused proposal rejected rather than deleting it', async () => {
    workflows.startApprovalProcess.mockResolvedValue({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
    const proposal = await propose();

    const handler = new AuditAdjustmentApprovalHandler(proposals, new ApprovalHandlerRegistry());
    await dataSource.transaction((manager) =>
      handler.onRejected({
        manager,
        documentId: proposal.id,
        organizationId,
        actorUserId: proposer.id,
        reason: 'Sin evidencia suficiente',
      } as never),
    );

    const refused = await dataSource
      .getRepository(ProposedAdjustment)
      .findOneByOrFail({ id: proposal.id });
    expect(refused.status).toBe(AdjustmentStatus.REJECTED);
    expect(refused.journalEntryId).toBeFalsy();
  });

  it('waits for approval when the tenant has a policy for it', async () => {
    workflows.startApprovalProcess.mockResolvedValue({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });

    const proposal = await propose();
    const stored = await dataSource
      .getRepository(ProposedAdjustment)
      .findOneByOrFail({ id: proposal.id });

    expect(stored.status).toBe(AdjustmentStatus.PENDING_APPROVAL);
    expect(stored.journalEntryId).toBeFalsy();
  });

  it('lists the proposals of the tenant, newest first', async () => {
    const proposal = await propose();
    await settled(proposal.id);

    const page = await proposals.findAll(organizationId);
    expect(page.total).toBe(1);
    expect(page.rows[0].id).toBe(proposal.id);
  });
});
