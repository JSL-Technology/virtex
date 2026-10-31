import { SalesOrdersService } from './sales-orders.service';
import { SalesOrderStatus } from '../entities/sales-order.entity';
import { DeliveryNoteStatus } from '../entities/delivery-note.entity';

const line = (over: Record<string, unknown>) =>
  ({ id: 'l', lineOrder: 0, isStocked: true, quantity: 10, deliveredQuantity: 0, invoicedQuantity: 0, ...over }) as never;

describe('SalesOrdersService arithmetic', () => {
  it('a stocked line invoices what its posted conduces delivered, a service what is still uninvoiced', () => {
    const goods = line({ id: 'g', deliveredQuantity: 4 });
    const service = line({ id: 's', lineOrder: 1, isStocked: false, quantity: 1 });
    const result = SalesOrdersService.invoiceable([goods, service], [
      { status: DeliveryNoteStatus.POSTED, lines: [{ orderLineId: 'g', quantity: 4 }] },
      { status: DeliveryNoteStatus.INVOICED, lines: [{ orderLineId: 'g', quantity: 3 }] },
    ]);
    expect(result.map((r) => [r.line.id, r.quantity])).toEqual([['g', 4], ['s', 1]]);
  });

  it('never invoices more of a line than is still uninvoiced', () => {
    const goods = line({ id: 'g', deliveredQuantity: 10, invoicedQuantity: 8 });
    const result = SalesOrdersService.invoiceable([goods], [{ status: DeliveryNoteStatus.POSTED, lines: [{ orderLineId: 'g', quantity: 5 }] }]);
    expect(result[0].quantity).toBe(2);
  });

  it.each([
    [[{ deliveredQuantity: 0 }], SalesOrderStatus.CONFIRMED],
    [[{ deliveredQuantity: 4 }], SalesOrderStatus.PARTIALLY_DELIVERED],
    [[{ deliveredQuantity: 10 }], SalesOrderStatus.DELIVERED],
    [[{ deliveredQuantity: 10, invoicedQuantity: 10 }], SalesOrderStatus.CLOSED],
  ])('status from the lines', (lines, expected) => {
    expect(SalesOrdersService.statusOf(lines.map((l) => line(l)), SalesOrderStatus.CONFIRMED)).toBe(expected);
  });

  it('a cancelled order stays cancelled', () => {
    expect(SalesOrdersService.statusOf([line({ deliveredQuantity: 10 })], SalesOrderStatus.CANCELLED)).toBe(SalesOrderStatus.CANCELLED);
  });
});
