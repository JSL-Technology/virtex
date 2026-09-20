import { DocumentLifecycle } from '@virteex/shared/types';
import { PurchaseOrderStatus } from './entities/purchase-order.entity';
import { PurchaseRequisitionStatus } from './entities/purchase-requisition.entity';

/**
 * La vida de una requisición y la de una orden de compra.
 *
 * Eran dos constantes dentro de sus servicios, y por tanto invisibles desde fuera: la pantalla que
 * muestra una orden no podía decir en qué punto está ni qué viene después sin volver a escribir
 * las mismas reglas. Aquí las lee el servicio —para decidir si una transición es legal— y la
 * interfaz —para dibujarla—, que es la diferencia entre una regla y dos copias de una regla.
 *
 * Las claves de traducción son las que la pantalla de compras ya usaba para pintar el estado
 * (`purchasing.*.status_label.*`), no unas nuevas. Inventar un segundo juego de nombres para
 * las mismas palabras es la misma duplicación que esto viene a quitar, un piso más abajo: dos
 * entradas de catálogo para «Enviada» acaban divergiendo en el momento en que alguien retoca
 * una. El runtime pasa la clave por `normalizeKey`, así que `SENT` encuentra `sent`.
 */
export const REQUISITION_LIFECYCLE: DocumentLifecycle<PurchaseRequisitionStatus> = {
  documentType: 'purchase-requisition',
  labelKey: 'purchasing.requisitions.document_name',
  stages: [
    {
      status: PurchaseRequisitionStatus.DRAFT,
      labelKey: 'purchasing.requisitions.status_label.draft',
      next: [PurchaseRequisitionStatus.PENDING_APPROVAL],
    },
    {
      status: PurchaseRequisitionStatus.PENDING_APPROVAL,
      labelKey: 'purchasing.requisitions.status_label.pending_approval',
      next: [
        PurchaseRequisitionStatus.APPROVED,
        PurchaseRequisitionStatus.REJECTED,
        PurchaseRequisitionStatus.DRAFT,
      ],
    },
    {
      status: PurchaseRequisitionStatus.APPROVED,
      labelKey: 'purchasing.requisitions.status_label.approved',
      next: [PurchaseRequisitionStatus.CONVERTED_TO_PO],
    },
    {
      status: PurchaseRequisitionStatus.REJECTED,
      labelKey: 'purchasing.requisitions.status_label.rejected',
      next: [PurchaseRequisitionStatus.DRAFT],
      // Rechazar no es un paso del camino: se vuelve al borrador o se abandona.
      exceptional: true,
    },
    {
      status: PurchaseRequisitionStatus.CONVERTED_TO_PO,
      labelKey: 'purchasing.requisitions.status_label.converted_to_po',
      next: [],
    },
  ],
};

export const PURCHASE_ORDER_LIFECYCLE: DocumentLifecycle<PurchaseOrderStatus> = {
  documentType: 'purchase-order',
  labelKey: 'purchasing.orders.document_name',
  stages: [
    {
      status: PurchaseOrderStatus.DRAFT,
      labelKey: 'purchasing.orders.status_label.draft',
      next: [PurchaseOrderStatus.PENDING_APPROVAL, PurchaseOrderStatus.CANCELLED],
    },
    {
      status: PurchaseOrderStatus.PENDING_APPROVAL,
      labelKey: 'purchasing.orders.status_label.pending_approval',
      next: [
        PurchaseOrderStatus.APPROVED,
        PurchaseOrderStatus.DRAFT,
        PurchaseOrderStatus.CANCELLED,
      ],
    },
    {
      status: PurchaseOrderStatus.APPROVED,
      labelKey: 'purchasing.orders.status_label.approved',
      next: [PurchaseOrderStatus.SENT, PurchaseOrderStatus.CANCELLED],
    },
    {
      status: PurchaseOrderStatus.SENT,
      labelKey: 'purchasing.orders.status_label.sent',
      next: [
        PurchaseOrderStatus.PARTIALLY_RECEIVED,
        PurchaseOrderStatus.RECEIVED,
        PurchaseOrderStatus.CANCELLED,
      ],
    },
    {
      status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
      labelKey: 'purchasing.orders.status_label.partially_received',
      next: [PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CANCELLED],
    },
    {
      status: PurchaseOrderStatus.RECEIVED,
      labelKey: 'purchasing.orders.status_label.received',
      next: [],
    },
    {
      status: PurchaseOrderStatus.CANCELLED,
      labelKey: 'purchasing.orders.status_label.cancelled',
      next: [],
      exceptional: true,
    },
  ],
};
