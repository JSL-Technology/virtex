import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ReturnsService } from './returns.service';
import { GenerateReturnQueryDto, returnOptionsOf } from '../dto/return-query.dto';
import type { Organization } from '../../organizations/entities/organization.entity';

/**
 * The door every market's returns go through.
 *
 * What a filing is called, what it carries and what it asks for is the market's
 * (`markets/<cc>/returns.ts`); this checks the part that is the same everywhere — resolving the
 * filing from the company's own market, and the options its authority declares.
 */
describe('ReturnsService — one door for every market', () => {
  const organizationOf = (country: string) =>
    ({
      findOne: jest.fn().mockResolvedValue({ id: 'org-1', country, taxId: '131190317', legalName: 'QA', fiscalProfile: {} } as Organization),
    }) as never;

  const datasets = {
    of: jest.fn(() => ({
      filer: { taxId: '131190317', legalName: 'QA', country: 'DO', fiscalProfile: {} },
      period: { year: 2026, month: 8, from: '2026-08-01', to: '2026-08-31' },
      sales: async () => [],
      purchases: async () => [],
      foreignPurchases: async () => [],
      accounts: async () => [],
      journals: async () => [],
    })),
  } as never;

  const service = (country: string) => new ReturnsService(organizationOf(country), datasets);

  it('offers what the company’s own market files, and nothing else', async () => {
    expect((await service('DO').available('org-1')).map((filing) => filing.code)).toEqual(['606', '607', '608', '609']);
    expect((await service('MX').available('org-1')).map((filing) => filing.code)).toEqual(['catalogo', 'balanza', 'polizas']);
    // A market the product files nothing for says so with an empty list, not with an empty file.
    expect(await service('CO').available('org-1')).toEqual([]);
  });

  it('builds a filing of this market, with the name its authority gives the file', async () => {
    const generated = await service('DO').generate('org-1', '607', { year: 2026, month: 8 });

    expect(generated.fileName).toBe('DGII_607_202608.txt');
    expect(generated.mediaType).toContain('text/plain');
    expect(generated.body).toBe('607|131190317|202608|0');
    expect(generated.records).toBe(0);
    expect(generated.tracked).toBe(true);
  });

  it('answers 404 for a filing this market does not have', async () => {
    // A Mexican tenant asking for a 607 is asking for a document that does not exist for them, and
    // a plausible-looking file that means nothing to their authority is the worse answer.
    await expect(service('MX').generate('org-1', '607', { year: 2026, month: 8 })).rejects.toMatchObject({
      messageKey: 'compliance.return_not_filed_in_this_market',
      status: 404,
    });
  });

  describe('the options an authority asks for', () => {
    const balanza = (options: Record<string, string>) =>
      service('MX').generate('org-1', 'balanza', { year: 2026, month: 8 }, options);

    it('refuses one the filing does not declare, rather than ignoring it', async () => {
      // A caller that sent it believes they said something.
      await expect(balanza({ tipoDeEnvio: 'C' })).rejects.toMatchObject({
        messageKey: 'compliance.return_option_not_declared',
        status: 400,
      });
    });

    it('refuses a value outside the published ones, and a date that is not one', async () => {
      await expect(balanza({ tipoEnvio: 'X' })).rejects.toMatchObject({
        messageKey: 'compliance.return_option_value_not_allowed',
      });
      await expect(balanza({ fechaModBal: '15/07/2026' })).rejects.toMatchObject({
        messageKey: 'compliance.return_option_date_expected',
      });
    });

    it('accepts the ones it declares, and treats an empty value as unsaid', async () => {
      await expect(balanza({ tipoEnvio: 'C', fechaModBal: '2026-07-15' })).resolves.toMatchObject({ code: 'balanza' });
      await expect(balanza({ tipoEnvio: '' })).resolves.toMatchObject({ code: 'balanza' });
    });
  });

  describe('the query the door accepts', () => {
    const parse = (query: Record<string, unknown>) => {
      const dto = plainToInstance(GenerateReturnQueryDto, query);
      return { dto, errors: validateSync(dto).map((error) => error.property) };
    };

    it('reads the period and the options as `name:value` pairs', () => {
      const { dto, errors } = parse({ year: '2026', month: '8', option: ['tipoEnvio:C', 'fechaModBal:2026-07-15'] });

      expect(errors).toEqual([]);
      expect(dto.year).toBe(2026);
      expect(returnOptionsOf(dto)).toEqual({ tipoEnvio: 'C', fechaModBal: '2026-07-15' });
    });

    it('reads a single pair sent once, which is how a query string carries one', () => {
      const { dto, errors } = parse({ year: 2026, month: 8, option: 'tipoEnvio:C' });
      expect(errors).toEqual([]);
      expect(returnOptionsOf(dto)).toEqual({ tipoEnvio: 'C' });
    });

    it('refuses a period outside the calendar and a pair that is not one', () => {
      expect(parse({ year: 2026, month: 13 }).errors).toEqual(['month']);
      expect(parse({ year: 1999, month: 1 }).errors).toEqual(['year']);
      expect(parse({ year: 2026, month: 1, option: ['no-separator'] }).errors).toEqual(['option']);
      expect(parse({ year: 2026, month: 1, option: Array(11).fill('a:b') }).errors).toEqual(['option']);
    });
  });
});
