import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import {
  ClosingBlocker,
  ClosingBlockerProvider,
  ClosingPeriodQuery,
} from '../contracts/closing-blockers/closing-blocker.contract';
import { ClosingBlockerRegistry } from '../contracts/closing-blockers/closing-blocker.registry';
import { VendorBill, VendorBillStatus } from './entities/vendor-bill.entity';

/**
 * Lo que Compras aporta al checklist de cierre de Contabilidad: facturas de proveedor sin aprobar.
 *
 * Antes esta cuenta la hacía `ClosingChecklistService` importando `VendorBill` directamente, que
 * era la única arista `contabilidad → compras` del proyecto y por sí sola cerraba el ciclo con las
 * 37 aristas que van en sentido contrario. Ahora la pregunta viaja por el contrato y la respuesta
 * la da el dueño de la tabla, que es quien sabe qué estados cuentan como «sin aprobar» y tiene
 * derecho a cambiarlos sin avisar a nadie.
 */
@Injectable()
export class VendorBillClosingBlockersProvider implements ClosingBlockerProvider, OnModuleInit {
  readonly providerName = 'accounts-payable';

  constructor(
    @InjectRepository(VendorBill)
    private readonly vendorBills: Repository<VendorBill>,
    private readonly registry: ClosingBlockerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async blockersFor(period: ClosingPeriodQuery): Promise<readonly ClosingBlocker[]> {
    const pendingCount = await this.vendorBills.count({
      where: {
        organizationId: period.organizationId,
        status: In([VendorBillStatus.DRAFT, VendorBillStatus.PENDING_APPROVAL]),
        // La fecha de un documento es una fecha de calendario, así que los límites también.
        date: Between(period.startDate, period.endDate),
      },
    });

    return [
      {
        id: 'unapproved-vendor-bills',
        descriptionKey: 'accounting.checklist.items.unapproved_vendor_bills',
        params: { count: pendingCount },
        isCompleted: pendingCount === 0,
        details: { pendingCount },
        resolutionLink: `/accounts-payable/bills?periodId=${period.periodId}&status=draft,pending_approval`,
      },
    ];
  }
}
