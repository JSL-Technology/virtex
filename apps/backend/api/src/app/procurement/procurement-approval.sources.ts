import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ApprovalSource,
  ApprovalViewer,
  PendingDecision,
} from '../contracts/approvals/approval-source.contract';
import { ApprovalSourceRegistry } from '../contracts/approvals/approval-source.registry';
import { PERMISSIONS } from '../shared/permissions';
import { PurchaseOrder, PurchaseOrderStatus } from './entities/purchase-order.entity';
import { PurchaseRequisition, PurchaseRequisitionStatus } from './entities/purchase-requisition.entity';
import { ProcurementService } from './procurement.service';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Whether the viewer is the only member of the company — the one case where approving your own
 * document is allowed, because there is nobody else to ask (the same rule the services enforce).
 */
async function aloneInCompany(dataSource: DataSource, viewer: ApprovalViewer): Promise<boolean> {
  const rows: Array<{ count: number }> = await dataSource.query(
    'SELECT COUNT(*)::int AS count FROM user_organizations WHERE organization_id = $1 AND user_id <> $2',
    [viewer.organizationId, viewer.userId],
  );
  return Number(rows[0]?.count ?? 0) === 0;
}

/** Purchase orders awaiting approval, in the approvals inbox (QA A-11). */
@Injectable()
export class PurchaseOrderApprovalSource implements ApprovalSource, OnModuleInit {
  readonly sourceId = 'purchase_order';
  readonly decidePermission = PERMISSIONS.PROCUREMENT_APPROVE;

  constructor(
    private readonly registry: ApprovalSourceRegistry,
    private readonly orders: PurchaseOrdersService,
    @InjectRepository(PurchaseOrder) private readonly repository: Repository<PurchaseOrder>,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async pendingFor(viewer: ApprovalViewer): Promise<PendingDecision[]> {
    const pending = await this.repository.find({
      where: { organizationId: viewer.organizationId, status: PurchaseOrderStatus.PENDING_APPROVAL },
      relations: { supplier: true },
      order: { orderDate: 'ASC', number: 'ASC' },
      take: 200,
    });
    const alone = pending.length ? await aloneInCompany(this.dataSource, viewer) : false;
    return pending.map((order) => {
      const own = order.createdByUserId === viewer.userId && !alone;
      return {
        source: this.sourceId,
        id: order.id,
        documentTypeKey: 'approvals.document_type.purchase_order',
        number: order.number,
        party: order.supplier?.name ?? null,
        amount: Number(order.total),
        currencyCode: order.currencyCode,
        requestedAt: order.orderDate,
        route: `/purchasing/orders/${order.id}/edit`,
        step: null,
        canDecide: !own,
        blockedReasonKey: own ? 'approvals.blocked.own_request' : null,
      };
    });
  }

  async approve(id: string, viewer: ApprovalViewer): Promise<void> {
    await this.orders.approve(id, viewer.organizationId, viewer.userId);
  }

  async reject(id: string, viewer: ApprovalViewer, reason: string): Promise<void> {
    await this.orders.reject(id, viewer.organizationId, viewer.userId, reason);
  }
}

/** Purchase requisitions awaiting approval, in the approvals inbox (QA A-11). */
@Injectable()
export class RequisitionApprovalSource implements ApprovalSource, OnModuleInit {
  readonly sourceId = 'purchase_requisition';
  readonly decidePermission = PERMISSIONS.PROCUREMENT_APPROVE;

  constructor(
    private readonly registry: ApprovalSourceRegistry,
    private readonly requisitions: ProcurementService,
    @InjectRepository(PurchaseRequisition) private readonly repository: Repository<PurchaseRequisition>,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async pendingFor(viewer: ApprovalViewer): Promise<PendingDecision[]> {
    const pending = await this.repository.find({
      where: { organizationId: viewer.organizationId, status: PurchaseRequisitionStatus.PENDING_APPROVAL },
      order: { requiredDate: 'ASC', number: 'ASC' },
      take: 200,
    });
    if (pending.length === 0) return [];
    const alone = await aloneInCompany(this.dataSource, viewer);
    const names = await this.requesterNames([...new Set(pending.map((r) => r.requestedByUserId))]);
    return pending.map((requisition) => {
      const own = requisition.requestedByUserId === viewer.userId && !alone;
      return {
        source: this.sourceId,
        id: requisition.id,
        documentTypeKey: 'approvals.document_type.purchase_requisition',
        number: requisition.number,
        party: names.get(requisition.requestedByUserId) ?? null,
        amount: Number(requisition.totalAmount),
        currencyCode: null,
        requestedAt: requisition.requiredDate,
        route: `/purchasing/requisitions/${requisition.id}/edit`,
        step: null,
        canDecide: !own,
        blockedReasonKey: own ? 'approvals.blocked.own_request' : null,
      };
    });
  }

  async approve(id: string, viewer: ApprovalViewer): Promise<void> {
    await this.requisitions.approve(id, viewer.organizationId, viewer.userId);
  }

  async reject(id: string, viewer: ApprovalViewer, reason: string): Promise<void> {
    await this.requisitions.reject(id, viewer.organizationId, viewer.userId, reason);
  }

  /** The requesters' names only — the inbox shows who asked, nothing else about them. */
  private async requesterNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows: Array<{ id: string; name: string }> = await this.dataSource.query(
      `SELECT id, TRIM(CONCAT("firstName", ' ', "lastName")) AS name FROM users WHERE id = ANY($1)`,
      [ids],
    );
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
