import { BadRequestError } from '../i18n/localized.exception';
import { TaxpayerType } from '../localization/fiscal/withholding-regimes';
import { WithholdingResolverService } from './services/withholding-resolver.service';

/**
 * Withholding at source follows the market's country pack (QA C-06).
 *
 * A US invoice offered «Withholding at source» and a «Designated withholding agent»: there is no such
 * thing on a US invoice. The form no longer shows them, and the server refuses a stated rate there
 * instead of recording it as an «override» of a regime that does not exist.
 */
describe('withholding outside a withholding market', () => {
  const managerIn = (country: string | null) =>
    ({
      getRepository: () => ({
        findOne: jest.fn(async () => ({ id: 'org', country })),
        find: jest.fn(async () => []),
      }),
    }) as never;

  const customer = { id: 'c1', taxpayerType: TaxpayerType.WITHHOLDING_AGENT, country: 'US' };

  it('withholds nothing in the United States', async () => {
    const resolved = await new WithholdingResolverService().resolve(managerIn('US'), 'org', customer as never, 'SERVICES', {});
    expect(resolved).toEqual({ taxWithholdingRate: 0, incomeTaxWithholdingRate: 0, regimeCodes: [] });
  });

  it('accepts zeros, which is what the form sends', async () => {
    const resolved = await new WithholdingResolverService().resolve(managerIn('US'), 'org', customer as never, 'GOODS', {
      taxWithholdingRate: 0,
      incomeTaxWithholdingRate: 0,
    });
    expect(resolved.regimeCodes).toEqual([]);
  });

  it('refuses a stated rate there, even with a reason', async () => {
    await expect(
      new WithholdingResolverService().resolve(managerIn('US'), 'org', customer as never, 'SERVICES', {
        taxWithholdingRate: 0.3,
        withholdingOverrideReason: 'Because I say so',
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('refuses it on a purchase too', async () => {
    await expect(
      new WithholdingResolverService().resolveForPurchase(
        managerIn('US'),
        'org',
        { id: 's1', taxpayerType: TaxpayerType.INDIVIDUAL, country: 'US' },
        'SERVICES',
        { incomeTaxWithholdingRate: 0.1 },
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
