import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFixedAssetDto, DisposeAssetDto, UpdateFixedAssetDto } from './fixed-asset.dto';

/**
 * The register's dates are days that exist (FINB-14).
 *
 * The acquisition date was checked by a regular expression, so «2026-02-30» passed validation and
 * reached the database, which refused it — and the request answered a 500.
 */
describe('fixed-asset dates', () => {
  const asset = (overrides: Record<string, unknown> = {}) =>
    plainToInstance(CreateFixedAssetDto, {
      name: 'Camioneta',
      acquisitionDate: '2026-02-28',
      cost: 120_000,
      usefulLifeMonths: 60,
      assetAccountId: '00000000-0000-4000-8000-000000000001',
      accumulatedDepreciationAccountId: '00000000-0000-4000-8000-000000000002',
      ...overrides,
    });
  const failing = async (dto: object) => (await validate(dto)).map((error) => error.property);

  it('accepts a day the calendar has', async () => {
    expect(await failing(asset())).toEqual([]);
    expect(await failing(asset({ acquisitionDate: '2028-02-29' }))).toEqual([]);
  });

  it.each(['2026-02-30', '2026-02-29', '2026-13-01', '2026-04-31', '20260315', '2026-03-15T00:00:00Z', '2026-03-15 '])(
    'refuses %p as the acquisition date, and as the date it entered service',
    async (date) => {
      expect(await failing(asset({ acquisitionDate: date }))).toEqual(['acquisitionDate']);
      expect(await failing(asset({ inServiceDate: date }))).toEqual(['inServiceDate']);
    },
  );

  it('refuses an impossible day when editing and when disposing', async () => {
    expect(await failing(plainToInstance(UpdateFixedAssetDto, { acquisitionDate: '2026-02-30' }))).toEqual(['acquisitionDate']);
    expect(await failing(plainToInstance(DisposeAssetDto, { disposalDate: '2026-02-30', salePrice: 0, disposalReason: 'Robo' }))).toEqual([
      'disposalDate',
    ]);
  });
});
