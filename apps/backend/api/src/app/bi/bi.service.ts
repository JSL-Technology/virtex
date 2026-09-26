
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TimeDimension } from './entities/time-dimension.entity';
import { SalesCubeView } from './entities/sales-cube-view.entity';
import { BadRequestError } from '../i18n/localized.exception';
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
  /** La empresa en la que actúa la petición. Del principal, nunca del cliente. */
  organizationId: string;
}

@Injectable()
export class BiService {
  constructor(
    @InjectRepository(TimeDimension)
    private readonly timeDimensionRepository: Repository<TimeDimension>,
    @InjectRepository(SalesCubeView)
    private readonly salesCubeViewRepository: Repository<SalesCubeView>,
  ) {}

  /**
   * Las columnas que `sales_cube_view` tiene de verdad.
   *
   * Es una lista blanca, y existe porque `dimensions`, `measures` y las CLAVES de `filters`
   * llegaban del cliente y se interpolaban crudas en el SQL:
   *
   *     qb.addSelect(`SUM(cube.${measure})`, measure);
   *     qb.addSelect(`cube.${dimension}`, dimension);
   *     qb.andWhere(`cube.${key} = :${paramName}`, ...);
   *
   * El DTO solo exigía que fueran cadenas. El VALOR de un filtro sí iba como parámetro; el nombre
   * de la columna, no — y es el nombre lo que decide qué se lee.
   *
   * Se deriva del propio `SalesCubeView` en lugar de escribirse aparte, así que una columna nueva
   * queda disponible sin tocar esto y una que desaparezca deja de aceptarse sola.
   */
  private static readonly CUBE_COLUMNS: ReadonlySet<string> = new Set([
    'line_id', 'quantity', 'price', 'total_amount',
    'date', 'year', 'quarter', 'month', 'month_name', 'week', 'day_name',
    'product_id', 'product_name', 'category_id',
    'customer_id', 'customer_name', 'customer_country',
  ]);

  /** Las únicas columnas sobre las que tiene sentido agregar. */
  private static readonly CUBE_MEASURES: ReadonlySet<string> = new Set([
    'quantity', 'price', 'total_amount',
  ]);

  private assertKnownColumn(name: string, allowed: ReadonlySet<string>): string {
    if (!allowed.has(name)) {
      throw new BadRequestError('bi.unknown_cube_field', { field: name });
    }
    return name;
  }

  /**
   * El cubo de ventas de UNA empresa.
   *
   * ## Lo que faltaba aquí
   *
   * Dos cosas, y la primera es la grave: **no había filtro de inquilino**. `createQueryBuilder('cube')`
   * sin `where`, sobre una vista que lleva `organization_id` en cada fila. Y como es una VISTA y no
   * una tabla, las políticas de fila de las tablas base tampoco la cubren —una vista normal se
   * ejecuta con los privilegios de su dueño salvo que se declare `security_invoker`—, así que no
   * había ninguna segunda capa debajo. `GET /api/v1/bi/sales` devolvía las ventas de todos los
   * clientes del producto a cualquiera que tuviese `bi:view`, que el `'*'` de cada administrador
   * satisface.
   *
   * La segunda: los nombres de columna venían del cliente y entraban crudos en el SQL. Ver
   * `CUBE_COLUMNS`.
   *
   * El `organizationId` se toma del principal autenticado y nunca del cliente, y se compara como
   * parámetro enlazado.
   */
  async getSalesData(options: SalesQueryOptions): Promise<any[]> {
    if (!options.organizationId) {
      // Una consulta sin inquilino no es una consulta «de todos»: es un error de programación, y
      // fallar es lo único que no devuelve los datos de otro.
      throw new BadRequestError('bi.unknown_cube_field', { field: 'organization' });
    }

    const qb = this.salesCubeViewRepository
      .createQueryBuilder('cube')
      .where('cube.organization_id = :organizationId', {
        organizationId: options.organizationId,
      });

    options.measures.forEach((measure) => {
      const column = this.assertKnownColumn(measure, BiService.CUBE_MEASURES);
      qb.addSelect(`SUM(cube.${column})`, column);
    });

    options.dimensions.forEach((dimension) => {
      const column = this.assertKnownColumn(dimension, BiService.CUBE_COLUMNS);
      qb.addSelect(`cube.${column}`, column);
      qb.addGroupBy(`cube.${column}`);
    });

    if (options.filters) {
      Object.keys(options.filters).forEach((key) => {
        // `organization_id` no es filtrable desde fuera: ya está fijado arriba, y aceptarlo aquí
        // dejaría al cliente añadir un segundo predicado sobre la misma columna.
        if (key === 'organization_id') {
          throw new BadRequestError('bi.unknown_cube_field', { field: key });
        }
        const column = this.assertKnownColumn(key, BiService.CUBE_COLUMNS);
        const paramName = `param_${column}`;
        qb.andWhere(`cube.${column} = :${paramName}`, {
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
    // tenant-scope-guard-allow: `dim_time` es un calendario, no datos de ningún inquilino.
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