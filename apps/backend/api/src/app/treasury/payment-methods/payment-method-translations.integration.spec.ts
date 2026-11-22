import { DataSource } from 'typeorm';
import { PaymentMethod } from '../entities/payment-method.entity';
import { PaymentMethodsService } from './payment-methods.service';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../../common/database/testing/integration-db';

/**
 * How a payment method reads in another language (books bilingual, part 3). The DGII's catalogue
 * fixes a Dominican company's methods — their codes, their names in the books, their kinds — and
 * still a controller who reads English needs «Cash» where the books say «Efectivo».
 */
describeWithDb('a payment method named in several languages', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let organizationId: string;
  let methods: PaymentMethodsService;
  let cashId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'payment-names');
    await ds.query(`UPDATE organizations SET books_language = 'es', country = 'DO' WHERE id = $1`, [organizationId]);
    // As the DGII's catalogue seeds it: fixed by the authority.
    cashId = (
      await ds.query(
        `INSERT INTO payment_methods (organization_id, code, name, kind, fiscal_code, is_system, is_active, sort_order)
         VALUES ($1, '01', 'Efectivo', 'CASH', '01', true, true, 10) RETURNING id`,
        [organizationId],
      )
    )[0].id;
    methods = new PaymentMethodsService(ds.getRepository(PaymentMethod), { resolveOrNull: async () => 'DO' } as never);
  });

  afterAll(async () => {
    await dropTestOrganization(ds, organizationId);
  });

  it('lets a method the authority fixed be read in other languages', async () => {
    const updated = await methods.update(cashId, { nameTranslations: { en: 'Cash', pt: 'Dinheiro' } }, organizationId);
    expect(updated.nameTranslations).toEqual({ en: 'Cash', pt: 'Dinheiro' });
    const [row] = await ds.query(`SELECT name, code, kind FROM payment_methods WHERE id = $1`, [cashId]);
    expect(row).toEqual({ name: 'Efectivo', code: '01', kind: 'CASH' });
  });

  it('still refuses anything the authority fixed — its name in the books included', async () => {
    await expect(methods.update(cashId, { name: 'Contado' }, organizationId)).rejects.toMatchObject({
      messageKey: 'treasury.payment_methods_fixed_in_market',
    });
    await expect(methods.update(cashId, { name: 'Contado', nameTranslations: { en: 'Cash' } }, organizationId)).rejects.toMatchObject({
      messageKey: 'treasury.payment_methods_fixed_in_market',
    });
  });
});
