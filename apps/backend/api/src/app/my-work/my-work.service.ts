import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../security/principal';
import { ApprovalsInboxService } from './approvals-inbox.service';
import { MyWorkDto, WorkItemDto } from './dto/my-work.dto';

/**
 * The caller's work queue.
 *
 * Its approvals used to be every pending request of the generic workflow engine — whether or not
 * the caller could decide it, and blind to purchase orders and requisitions, which have their own
 * approval lifecycle (QA A-11). They are now the approvals inbox's items THIS user can decide:
 * what is waiting on them, and nothing that is waiting on someone else.
 */
@Injectable()
export class MyWorkService {
  constructor(private readonly inbox: ApprovalsInboxService) {}

  async getWorkItems(user: AuthenticatedUser): Promise<MyWorkDto> {
    const decisions = await this.inbox.pending(user);
    const approvals: WorkItemDto[] = decisions
      .filter((decision) => decision.canDecide)
      .map((decision) => ({
        id: `${decision.source}:${decision.id}`,
        titleKey: decision.documentTypeKey,
        titleParams: {
          number: decision.number,
          party: decision.party,
          amount: decision.amount,
          currency: decision.currencyCode,
        },
        dueDate: decision.requestedAt,
        status: 'pending',
        route: decision.route,
      }));
    return { tasks: [], approvals, notifications: [] };
  }
}
