import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { InventoryService } from '../inventory.service';

/** The subset of a vendor bill line needed to adjust stock. */
export interface VendorBillLine {
  productId: string | null | undefined;
  quantity: number;
}

/** Payload for the event emitted after a vendor bill is approved and posted. */
export interface VendorBillPostedEvent {
  billId: string;
  organizationId: string;
  journalEntryId: string;
  /** Lines that carry inventory items. Only lines with a productId affect stock. */
  lines: VendorBillLine[];
}

/** Payload for the event emitted after a posted vendor bill is voided. */
export interface VendorBillVoidedEvent {
  billId: string;
  organizationId: string;
  reason: string;
  actorUserId: string;
  reversalJournalEntryId: string | null | undefined;
  /** Lines from the original bill. Only lines with a productId have stock to return. */
  lines: VendorBillLine[];
  /** True when the bill had reached OPEN or PARTIALLY_PAID before being voided. */
  wasPosted: boolean;
}

/**
 * Adjusts inventory stock in response to vendor bill lifecycle events.
 *
 * ## Why this is an event handler and not a direct call
 *
 * `AccountsPayableService` previously called `InventoryService.increaseStock` and
 * `decreaseStock` directly, creating an AP → Inventory module dependency that prevented
 * either from being extracted independently.
 *
 * The handler runs AFTER the AP transaction commits (via `AfterCommitService`), so the
 * stock adjustment is NOT atomic with the accounting entry. This is an accepted trade-off:
 * the right model is a three-way matched goods receipt in Procurement. Until that exists,
 * the event gives the correct eventual result without coupling the two modules.
 */
@Injectable()
export class VendorBillInventoryHandler {
  private readonly logger = new Logger(VendorBillInventoryHandler.name);

  constructor(
    private readonly inventory: InventoryService,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent('vendor.bill.posted', { async: false })
  onBillPosted(payload: VendorBillPostedEvent): void {
    const productLines = payload.lines.filter((line) => line.productId);
    if (productLines.length === 0) return;

    this.dataSource
      .transaction(async (manager) => {
        for (const line of productLines) {
          await this.inventory.increaseStock(
            line.productId as string,
            line.quantity,
            manager,
            payload.organizationId,
          );
        }
      })
      .catch((error) => {
        this.logger.error(
          `Error al actualizar inventario para la factura ${payload.billId}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      });
  }

  @OnEvent('vendor.bill.voided', { async: false })
  onBillVoided(payload: VendorBillVoidedEvent): void {
    if (!payload.wasPosted) return;
    const productLines = payload.lines.filter((line) => line.productId);
    if (productLines.length === 0) return;

    this.dataSource
      .transaction(async (manager) => {
        for (const line of productLines) {
          await this.inventory.decreaseStock(
            line.productId as string,
            line.quantity,
            manager,
            payload.organizationId,
          );
        }
      })
      .catch((error) => {
        this.logger.error(
          `Error al revertir inventario para la anulación de factura ${payload.billId}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      });
  }
}
