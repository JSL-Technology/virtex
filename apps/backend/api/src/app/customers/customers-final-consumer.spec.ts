import { CustomersService } from './customers.service';

/** The company's «Consumidor final» is the buyer of every unnamed sale: it is never deleted. */
describe('CustomersService.remove — the final consumer', () => {
  const finalConsumer = { id: 'c-1', organizationId: 'org-1', isFinalConsumer: true };
  const transaction = jest.fn();
  const service = new CustomersService(
    { findOne: jest.fn(async () => finalConsumer) } as never,
    { transaction } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('refuses, saying why and that it can be renamed', async () => {
    await expect(service.remove('c-1', 'org-1')).rejects.toMatchObject({
      messageKey: 'customers.final_consumer_cannot_be_deleted',
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
