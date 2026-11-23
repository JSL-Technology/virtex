import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreditNoteBodyDto } from './create-credit-note.dto';

describe('CreditNoteBodyDto', () => {
  const errorsOf = (body: object) => validateSync(plainToInstance(CreditNoteBodyDto, body), { whitelist: true, forbidNonWhitelisted: true });

  it('accepts the body the UI sends, without repeating the invoice that comes from the route', () => {
    expect(errorsOf({ reason: 'Error de digitación' })).toHaveLength(0);
    expect(errorsOf({ reason: 'Devolución', items: [{ lineId: '0e98aea8-acff-4334-a9d1-e8d41285aae0', quantity: 1 }], restockGoods: true })).toHaveLength(0);
  });

  it('still validates the lines it is given', () => {
    expect(errorsOf({ items: [{ lineId: 'no-uuid', quantity: 0 }] })).not.toHaveLength(0);
  });

  it('takes the reason in the product\'s own terms, and no authority\'s code', () => {
    expect(errorsOf({ reason: 'Devolución', adjustmentReason: 'GOODS_RETURN' })).toHaveLength(0);
    // A debit note's reason explains a charge added, which a credit note cannot carry.
    expect(errorsOf({ reason: 'Intereses', adjustmentReason: 'LATE_PAYMENT_INTEREST' })).not.toHaveLength(0);
    // The DGII's `CodigoModificacion` used to be accepted here, from a tenant of any market.
    expect(errorsOf({ reason: 'Anulación', modificationCode: '1' })).not.toHaveLength(0);
    expect(errorsOf({ reason: 'Anulación', adjustmentReason: '1' })).not.toHaveLength(0);
  });
});
