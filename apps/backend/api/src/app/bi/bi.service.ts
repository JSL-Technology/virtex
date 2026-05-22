
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TimeDimension } from './entities/time-dimension.entity';
import { SalesCubeView } from './entities/sales-cube-view.entity';
import {
  format,
  eachDayOfInterval,
  getYear,
  getQuarter,
  getMonth,
  getWeek,
  getDate,
  getDay,
} from 'date-fns';
import { es } from 'date-fns/locale';

interface SalesQueryOptions {
  dimensions: string[];
  measures: string[];
  filters?: { [key: string]: any };
}

@Injectable()
export class BiService {
  constructor(
    @InjectRepository(TimeDimension)
    private readonly timeDimensionRepository: Repository<TimeDimension>,
    @InjectRepository(SalesCubeView)
    private readonly salesCubeViewRepository: Repository<SalesCubeView>,
  ) {}

  async getSalesData(options: SalesQueryOptions): Promise<any[]> {
    const qb = this.salesCubeViewRepository.createQueryBuilder('cube');


    options.measures.forEach((measure) => {
      qb.addSelect(`SUM(cube.${measure})`, measure);
    });


    options.dimensions.forEach((dimension) => {
      qb.addSelect(`cube.${dimension}`, dimension);
      qb.addGroupBy(`cube.${dimension}`);
    });


    if (options.filters) {

      Object.keys(options.filters).forEach((key, index) => {
        const paramName = `param_${key}`;
        qb.andWhere(`cube.${key} = :${paramName}`, {
          [paramName]: options.filters![key],
        });
      });
    }


    options.dimensions.forEach((dimension) => {
      qb.addOrderBy(`cube.${dimension}`);
    });

    return qb.getRawMany();
  }


  async populateTimeDimension(
    startDate: string,
    endDate: string,
  ): Promise<void> {
    const days = eachDayOfInterval({
      start: new Date(startDate),
      end: new Date(endDate),
    });

    const timeDimensions: TimeDimension[] = [];
    const existingDates = new Set(
      (await this.timeDimensionRepository.find({ select: ['date'] })).map(
        (d) => d.date,
      ),
    );

    for (const day of days) {
      const dateString = format(day, 'yyyy-MM-dd');
      if (existingDates.has(dateString)) {
        continue;
      }

      const timeDimension = new TimeDimension();
      timeDimension.date = dateString;
      timeDimension.year = getYear(day);
      timeDimension.quarter = getQuarter(day);
      timeDimension.month = getMonth(day) + 1;
      timeDimension.monthName = format(day, 'MMMM', { locale: es });
      timeDimension.week = getWeek(day);
      timeDimension.day = getDate(day);
      timeDimension.dayOfWeek = getDay(day);
      timeDimension.dayName = format(day, 'EEEE', { locale: es });
      timeDimensions.push(timeDimension);
    }

    if (timeDimensions.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < timeDimensions.length; i += chunkSize) {
        const chunk = timeDimensions.slice(i, i + chunkSize);
        await this.timeDimensionRepository.save(chunk);
      }
      console.log(
        `Se han insertado ${timeDimensions.length} nuevos registros en dim_time.`,
      );
    } else {
      console.log(
        'No se encontraron nuevos registros para insertar en dim_time.',
      );
    }
  }
}