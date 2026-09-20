import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  INBOX_ITEM_LIMIT,
  ModuleInbox,
  ModuleInboxPort,
} from '../../shared/inbox/module-inbox.port';
import { ModuleInboxRegistry } from '../../shared/inbox/module-inbox.registry';
import { VendorBill, VendorBillStatus } from '../entities/vendor-bill.entity';

/**
 * Lo que tiene bloqueado Compras.
 *
 * Facturas de proveedor en borrador o esperando aprobación: un gasto que ya ocurrió y todavía no
 * está en los libros. Cuanto más tiempo lleve ahí, más probable es que el periodo se cierre sin
 * él y haya que reabrirlo.
 */
@Injectable()
export class PayablesInboxProvider extends ModuleInboxPort implements OnModuleInit {
  readonly moduleId = 'compras';

  constructor(
    @InjectRepository(VendorBill)
    private readonly bills: Repository<VendorBill>,
    private readonly registry: ModuleInboxRegistry,
  ) {
    super();
  }

  /** Se apunta solo: la bandeja no lleva una lista de módulos que alguien deba recordar. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  async pending(organizationId: string): Promise<ModuleInbox> {
    const [pending, count] = await this.bills.findAndCount({
      where: {
        organizationId,
        status: In([VendorBillStatus.DRAFT, VendorBillStatus.PENDING_APPROVAL]),
      },
      order: { date: 'ASC' },
      take: INBOX_ITEM_LIMIT,
    });

    return {
      moduleId: this.moduleId,
      count,
      items: pending.map((bill) => ({
        id: bill.id,
        titleKey:
          bill.status === VendorBillStatus.PENDING_APPROVAL
            ? 'inbox.payables.awaiting_approval'
            : 'inbox.payables.draft_bill',
        titleParams: { number: bill.ncf ?? bill.id.slice(0, 8) },
        route: `/accounts-payable/${bill.id}`,
        blockedSince: new Date(bill.date).toISOString(),
      })),
    };
  }
}
