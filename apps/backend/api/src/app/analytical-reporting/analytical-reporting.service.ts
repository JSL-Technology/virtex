
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { AnalyticalQueryDto, PaginationOptionsDto } from './dto/analytical-query.dto';
import { Dimension } from '../dimensions/entities/dimension.entity';
import { BadRequestError } from '../i18n/localized.exception';

@Injectable()
export class AnalyticalReportingService {
  private readonly logger = new Logger(AnalyticalReportingService.name);
  private readonly VIEW_NAME = 'analytical_report_data';

  constructor(private readonly dataSource: DataSource) {}

  async synchronizeView(organizationId: string): Promise<{ message: string }> {
    const dimensions = await this.dataSource.manager.find(Dimension, { where: { organizationId } });
    const viewName = this.VIEW_NAME;

    this.logger.log(`Iniciando sincronización de la vista materializada para ${organizationId}. ${dimensions.length} dimensiones encontradas.`);


    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {

      await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS "${viewName}"`);


      const dynamicDimensionColumns = dimensions
        .map(dim => `jel.dimensions ->> '${dim.name}' AS "${this.sanitizeColumnName(dim.name)}"`)
        .join(',\n');


      const viewQuery = `
          CREATE MATERIALIZED VIEW "${viewName}" AS
          SELECT
              je.id AS journal_entry_id,
              jel.id AS journal_entry_line_id,
              je.organization_id,
              jlv.ledger_id,
              je.date,
              EXTRACT(YEAR FROM je.date) AS year,
              EXTRACT(MONTH FROM je.date) AS month,
              EXTRACT(QUARTER FROM je.date) AS quarter,
              jel.account_id,
              (SELECT string_agg(seg."value", '-' ORDER BY seg."order")
                   FROM "account_segments" seg
                  WHERE seg."account_id" = acc."id") AS account_code,
              acc.name AS account_name,
              acc.type AS account_type,
              acc.category AS account_category,
              jlv.debit,
              jlv.credit,
              (jlv.debit - jlv.credit) AS net_change
              ${dynamicDimensionColumns ? `, ${dynamicDimensionColumns}` : ''}
          FROM
              journal_entry_lines jel
          INNER JOIN journal_entries je ON jel.journal_entry_id = je.id
          INNER JOIN accounts acc ON jel.account_id = acc.id
          INNER JOIN journal_entry_line_valuations jlv ON jlv.journal_entry_line_id = jel.id
          WHERE je.status = 'Posted';
      `;

      await queryRunner.query(viewQuery);


      await queryRunner.query(`CREATE UNIQUE INDEX ON "${viewName}" (journal_entry_line_id, ledger_id);`);
      await queryRunner.query(`CREATE INDEX ON "${viewName}" (organization_id, ledger_id, date);`);
      await queryRunner.query(`CREATE INDEX ON "${viewName}" (account_id);`);
      for (const dim of dimensions) {
        await queryRunner.query(`CREATE INDEX ON "${viewName}" ("${this.sanitizeColumnName(dim.name)}");`);
      }

      await queryRunner.commitTransaction();
      this.logger.log(`Vista materializada "${viewName}" sincronizada exitosamente.`);
      return { message: 'Vista materializada sincronizada y recreada con las dimensiones actuales.' };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Fallo la sincronización de la vista materializada.', (error as Error).stack);
      throw new BadRequestError('ANALYTICAL_REPORTING.NO_PUDO_SINCRONIZAR_VISTA_ANALITICA', { p1: (error as Error).message });
    } finally {
      await queryRunner.release();
    }
  }

  async query(
    organizationId: string,
    queryDto: AnalyticalQueryDto,
    paginationDto: PaginationOptionsDto,
  ): Promise<any> {
    const { ledgerId, measures, dimensions = [], filters = [] } = queryDto;
    const { page, limit } = paginationDto;

    const qb = this.dataSource.createQueryBuilder()
      .from(this.VIEW_NAME, 'ard')
      .where('ard.organization_id = :organizationId', { organizationId })
      .andWhere('ard.ledger_id = :ledgerId', { ledgerId });


    if (queryDto.period) {
      qb.andWhere('ard.date BETWEEN :startDate AND :endDate', {
        startDate: queryDto.period.startDate,
        endDate: queryDto.period.endDate,
      });
    }


    filters.forEach((filter, index) => {
      const paramName = `filter_val_${index}`;
      const sanitizedField = `ard."${this.sanitizeColumnName(filter.field)}"`;
      switch (filter.operator) {
        case 'eq':
          qb.andWhere(`${sanitizedField} = :${paramName}`, { [paramName]: filter.value });
          break;
        case 'neq':
          qb.andWhere(`${sanitizedField} != :${paramName}`, { [paramName]: filter.value });
          break;
        case 'in':
          if (!Array.isArray(filter.value)) throw new BadRequestError('ANALYTICAL_REPORTING.VALOR_OPERADOR_IN_DEBE_SER_ARRAY');
          qb.andWhere(`${sanitizedField} IN (:...${paramName})`, { [paramName]: filter.value });
          break;
        default:
          throw new BadRequestError('ANALYTICAL_REPORTING.OPERADOR_FILTRO_NO_SOPORTADO', { operator: filter.operator });
      }
    });


    measures.forEach(measure => {
      qb.addSelect(`SUM(ard.${measure})`, `"${measure}"`);
    });

    dimensions.forEach(dim => {
      const sanitizedDim = `"${this.sanitizeColumnName(dim)}"`;
      qb.addSelect(`ard.${sanitizedDim}`, sanitizedDim);
      qb.groupBy(`ard.${sanitizedDim}`);
      qb.orderBy(`ard.${sanitizedDim}`);
    });
    

    const countQuery = qb.clone().select('COUNT(*) as count');
    const totalResult = await countQuery.getRawOne();
    const totalItems = parseInt(totalResult.count, 10);


    qb.offset((page - 1) * limit);
    qb.limit(limit);

    const data = await qb.getRawMany();

    return {
      data,
      meta: {
        totalItems,
        itemCount: data.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
      }
    };
  }

  async refreshMaterializedView(): Promise<void> {
    this.logger.log('Refrescando la vista materializada de reportes analíticos...');
    try {
      await this.dataSource.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${this.VIEW_NAME}"`);
      this.logger.log('Vista materializada refrescada exitosamente.');
    } catch (error) {
      this.logger.error('Fallo al refrescar la vista materializada. Puede que necesite ser recreada.', (error as Error).stack);

    }
  }

  private sanitizeColumnName(name: string): string {
    if (!/^[a-zA-Z0-9_ ]+$/.test(name)) {
      throw new BadRequestError('ANALYTICAL_REPORTING.NOMBRE_DIMENSION_CAMPO_CONTIENE_CARACTERES_NO_VALIDOS', { name });
    }
    return name.replace(/ /g, '_').toLowerCase();
  }
}