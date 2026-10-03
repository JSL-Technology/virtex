import { Injectable, Logger } from '@nestjs/common';
import { hasPermission } from '@virteex/shared/util-auth';
import {
  ApprovalSource,
  ApprovalViewer,
  PendingDecision,
} from '../contracts/approvals/approval-source.contract';
import { ApprovalSourceRegistry } from '../contracts/approvals/approval-source.registry';
import { ForbiddenError, NotFoundError } from '../i18n/localized.exception';
import { AuthenticatedUser } from '../security/principal';

/**
 * One inbox for every document waiting on a decision (QA A-11).
 *
 * Reads every registered source the viewer may decide on — the workflow engine, purchase orders,
 * requisitions… — and routes each decision back to the source that owns the document, which
 * applies its own rules (segregation of duties, the step's role, the document's state).
 */
@Injectable()
export class ApprovalsInboxService {
  private readonly logger = new Logger(ApprovalsInboxService.name);

  constructor(private readonly registry: ApprovalSourceRegistry) {}

  async pending(user: AuthenticatedUser): Promise<PendingDecision[]> {
    const viewer = viewerOf(user);
    const answers = await Promise.all(
      this.sourcesFor(viewer).map(async (source) => {
        try {
          return await source.pendingFor(viewer);
        } catch (error) {
          // One failing source must not empty the inbox: the others still have work waiting.
          this.logger.error(`La fuente de aprobaciones «${source.sourceId}» falló: ${(error as Error).message}`);
          return [];
        }
      }),
    );
    return answers.flat().sort((a, b) => Number(b.canDecide) - Number(a.canDecide));
  }

  async approve(user: AuthenticatedUser, sourceId: string, id: string, comment?: string): Promise<void> {
    const viewer = viewerOf(user);
    await this.source(viewer, sourceId).approve(id, viewer, comment);
  }

  async reject(user: AuthenticatedUser, sourceId: string, id: string, reason: string): Promise<void> {
    const viewer = viewerOf(user);
    await this.source(viewer, sourceId).reject(id, viewer, reason);
  }

  private sourcesFor(viewer: ApprovalViewer): ApprovalSource[] {
    return this.registry.all().filter((source) => hasPermission([...viewer.permissions], [source.decidePermission]));
  }

  private source(viewer: ApprovalViewer, sourceId: string): ApprovalSource {
    const source = this.registry.get(sourceId);
    if (!source) throw new NotFoundError('approvals.unknown_source', { source: sourceId });
    if (!hasPermission([...viewer.permissions], [source.decidePermission])) {
      throw new ForbiddenError('approvals.not_allowed_to_decide');
    }
    return source;
  }
}

function viewerOf(user: AuthenticatedUser): ApprovalViewer {
  return {
    userId: user.id,
    organizationId: user.organizationId,
    permissions: user.permissions ?? [],
    roleIds: (user.roles ?? []).map((role) => role.id),
  };
}
