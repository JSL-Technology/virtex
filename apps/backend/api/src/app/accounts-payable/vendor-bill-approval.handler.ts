import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AccountsPayableService } from './accounts-payable.service';
import { VendorBill, VendorBillStatus } from './entities/vendor-bill.entity';
import { DocumentTypeForApproval } from '../workflows/entities/approval-policy.entity';
import {
  ApprovalHandler,
  ApprovalHandlerRegistry,
  ApprovalOutcomeContext,
} from '../workflows/approval-handler.registry';
import { NotFoundError } from '../i18n/localized.exception';

/**
 * Posting a supplier bill once its approval is granted.
 *
 * ## What this replaces
 *
 * `AccountsPayableService.handleBillApproved` was bound to `approval.request.approved`, an event
 * nothing emitted, so an approved bill was never posted. It also wrapped the posting in
 * `.catch(error => log)`, which meant that even had the event fired, a failure would have left the
 * bill REJECTED with the reason only in a log line — and the payables subledger and the general
 * ledger silently disagreeing about what the company owes.
 *
 * Now the posting shares the approval's transaction. A bill that cannot be posted cannot be
 * approved, and the approver is told why.
 */
@Injectable()
export class VendorBillApprovalHandler implements ApprovalHandler, OnModuleInit {
  readonly documentType = DocumentTypeForApproval.VENDOR_BILL;
  private readonly logger = new Logger(VendorBillApprovalHandler.name);

  constructor(
    private readonly payables: AccountsPayableService,
    private readonly registry: ApprovalHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onApproved(context: ApprovalOutcomeContext): Promise<void> {
    const { manager, documentId, organizationId, actorUserId } = context;

    const bill = await manager.findOne(VendorBill, {
      where: { id: documentId, organizationId },
      relations: ['lines', 'vendor'],
    });
    if (!bill) throw new NotFoundError('ACCOUNTS_PAYABLE.FACTURA_NO_ENCONTRADA_EN_LOTE', {
      id: documentId,
    });

    if (bill.status !== VendorBillStatus.PENDING_APPROVAL) {
      this.logger.warn(
        `Factura de proveedor ${documentId} en estado ${bill.status}; no requiere contabilización.`,
      );
      return;
    }

    await this.payables.postApprovedBill(manager, bill, organizationId, actorUserId);
  }

  /** A refused bill is not deleted: the proposal happened, and the reason is on the request. */
  async onRejected(context: ApprovalOutcomeContext): Promise<void> {
    const { manager, documentId, organizationId } = context;
    await manager.update(
      VendorBill,
      { id: documentId, organizationId, status: VendorBillStatus.PENDING_APPROVAL },
      { status: VendorBillStatus.REJECTED },
    );
  }
}
