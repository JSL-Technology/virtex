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
});
