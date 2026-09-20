import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';

import {
  INBOX_ITEM_LIMIT,
  InboxItem,
  ModuleInbox,
  ModuleInboxPort,
} from '../../shared/inbox/module-inbox.port';
import { ModuleInboxRegistry } from '../../shared/inbox/module-inbox.registry';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';

/**
 * Lo que tiene bloqueado Ventas.
 *
 * Dos colas de la EMPRESA: facturas en borrador —una venta que ocurrió y no se ha emitido, así que
 * ni está en los libros ni se puede cobrar— y facturas emitidas cuyo vencimiento ya pasó y siguen
 * sin cobrar. Las dos empeoran con el tiempo, que es lo que ordena la bandeja.
 *
 * Una factura vencida NO es un error de nadie: es trabajo que alguien tiene que hacer. Esa es la
 * diferencia entre una bandeja y una lista de alertas, y la razón de que la bandeja enlace al
 * documento en vez de a un informe.
 */
@Injectable()
export class SalesInboxProvider extends ModuleInboxPort implements OnModuleInit {
  readonly moduleId = 'ventas';

  constructor(
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    private readonly registry: ModuleInboxRegistry,
  ) {
    super();
  }

  /** Se apunta solo: la bandeja no lleva una lista de módulos que alguien deba recordar. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  async pending(organizationId: string): Promise<ModuleInbox> {
    const [drafts, draftCount] = await this.invoices.findAndCount({
      where: { organizationId, status: InvoiceStatus.DRAFT },
      order: { issueDate: 'ASC' },
      take: INBOX_ITEM_LIMIT,
    });

    const hoy = new Date().toISOString().slice(0, 10);
    const [overdue, overdueCount] = await this.invoices.findAndCount({
      where: {
        organizationId,
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID]),
        dueDate: LessThan(hoy),
      },
      order: { dueDate: 'ASC' },
      take: INBOX_ITEM_LIMIT,
    });

    const items: InboxItem[] = [
      ...overdue.map((invoice) => ({
        id: invoice.id,
        titleKey: 'inbox.sales.overdue_invoice',
        titleParams: { number: invoice.invoiceNumber ?? invoice.id.slice(0, 8) },
        route: `/invoices/${invoice.id}`,
        blockedSince: new Date(invoice.dueDate).toISOString(),
      })),
      ...drafts.map((invoice) => ({
        id: invoice.id,
        titleKey: 'inbox.sales.draft_invoice',
        titleParams: { number: invoice.invoiceNumber ?? invoice.id.slice(0, 8) },
        route: `/invoices/${invoice.id}`,
        blockedSince: new Date(invoice.issueDate).toISOString(),
      })),
    ]
      .sort((a, b) => a.blockedSince.localeCompare(b.blockedSince))
      .slice(0, INBOX_ITEM_LIMIT);

    return { moduleId: this.moduleId, count: draftCount + overdueCount, items };
  }
}
