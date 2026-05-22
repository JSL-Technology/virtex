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
    addSelect: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([{ year: 2023, total_amount: 1000 }]),
  };

  beforeEach(async () => {
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
  });
});
