import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BiService } from './bi.service';
import { SalesCubeView } from './entities/sales-cube-view.entity';
import { TimeDimension } from './entities/time-dimension.entity';

describe('BiService', () => {
  let service: BiService;
  let repository: Repository<SalesCubeView>;

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([{ year: 2023, total_amount: 1000 }]),
  };

  const ORG = 'org-1';

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BiService,
        {
          provide: getRepositoryToken(SalesCubeView),
          useValue: {
            createQueryBuilder: jest.fn(() => mockQueryBuilder),
          },
        },
        {
          provide: getRepositoryToken(TimeDimension),
          useValue: {

            find: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BiService>(BiService);
    repository = module.get<Repository<SalesCubeView>>(getRepositoryToken(SalesCubeView));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSalesData', () => {
    it('should correctly build a query with dimensions, measures, and filters', async () => {
      const options = {
        dimensions: ['year', 'customer_country'],
        measures: ['total_amount', 'quantity'],
        filters: { year: 2023 },
        organizationId: ORG,
      };

      await service.getSalesData(options);

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('cube');


      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith('SUM(cube.total_amount)', 'total_amount');
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith('SUM(cube.quantity)', 'quantity');


      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith('cube.year', 'year');
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith('cube.customer_country', 'customer_country');
      expect(mockQueryBuilder.addGroupBy).toHaveBeenCalledWith('cube.year');
      expect(mockQueryBuilder.addGroupBy).toHaveBeenCalledWith('cube.customer_country');


      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('cube.year = :param_year', { param_year: 2023 });


      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith('cube.year');
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith('cube.customer_country');


      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });

    /**
     * The cube had NO tenant filter at all.
     *
     * `createQueryBuilder('cube')` with no `where`, over a view that carries `organization_id` on
     * every row — and because it is a VIEW rather than a table, the row-level policies of the base
     * tables do not cover it either (a plain view runs with its owner's privileges unless declared
     * `security_invoker`). So `GET /api/v1/bi/sales` returned every customer's sales to anyone
     * holding `bi:view`, which the `'*'` of each tenant administrator satisfies.
     */
    it('scopes every query to the tenant, bound as a parameter', async () => {
      await service.getSalesData({
        dimensions: ['year'],
        measures: ['total_amount'],
        organizationId: ORG,
      });

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'cube.organization_id = :organizationId',
        { organizationId: ORG },
      );
    });

    it('refuses to query at all without a tenant', async () => {
      await expect(
        service.getSalesData({
          dimensions: ['year'],
          measures: ['total_amount'],
          organizationId: '',
        }),
      ).rejects.toBeDefined();

      expect(mockQueryBuilder.getRawMany).not.toHaveBeenCalled();
    });

    /**
     * The other half: column names came from the client and were interpolated raw.
     *
     *     qb.addSelect(`SUM(cube.${measure})`, measure);
     *     qb.andWhere(`cube.${key} = :${paramName}`, ...);
     *
     * The filter VALUE was bound as a parameter; the column NAME was not — and the name is what
     * decides which data is read. The DTO asked only that they be strings.
     */
    it.each([
      ['a dimension that is not a cube column', { dimensions: ['year; DROP TABLE users --'], measures: ['total_amount'] }],
      ['a measure that is not aggregatable', { dimensions: ['year'], measures: ['customer_name'] }],
      ['a measure that is not a cube column', { dimensions: ['year'], measures: ['(SELECT 1)'] }],
    ])('rejects %s', async (_label, partial) => {
      await expect(
        service.getSalesData({ ...partial, organizationId: ORG } as never),
      ).rejects.toBeDefined();

      expect(mockQueryBuilder.getRawMany).not.toHaveBeenCalled();
    });

    it('rejects a filter on a column the cube does not have', async () => {
      await expect(
        service.getSalesData({
          dimensions: ['year'],
          measures: ['total_amount'],
          filters: { 'id = id OR 1': 1 },
          organizationId: ORG,
        }),
      ).rejects.toBeDefined();
    });

    /** The tenant is fixed by the server; letting a filter name it again would undo that. */
    it('refuses a client-supplied filter on organization_id', async () => {
      await expect(
        service.getSalesData({
          dimensions: ['year'],
          measures: ['total_amount'],
          filters: { organization_id: 'someone-else' },
          organizationId: ORG,
        }),
      ).rejects.toBeDefined();
    });
  });
});
