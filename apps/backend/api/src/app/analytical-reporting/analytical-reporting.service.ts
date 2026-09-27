
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { AnalyticalQueryDto, PaginationOptionsDto } from './dto/analytical-query.dto';
import { Dimension } from '../dimensions/entities/dimension.entity';
import { BadRequestError } from '../i18n/localized.exception';
import { LocalizedMessage } from '../i18n/localized-message';

@Injectable()
export class AnalyticalReportingService {
  private readonly logger = new Logger(AnalyticalReportingService.name);
  private readonly VIEW_NAME = 'analytical_report_data';

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Reconstruye la vista materializada compartida.
   *
   * ## Por qué ya no recibe un `organizationId`
   *
   * Lo recibía, y leía `find(Dimension, { where: { organizationId } })` — las dimensiones de UN
   * inquilino— para después hacer `DROP` y `CREATE` de `analytical_report_data`, que es **una sola
   * vista para toda la instalación**. El efecto era cruzado y silencioso: el administrador de A
   * reconstruía la vista con las columnas de A, y las dimensiones de B desaparecían, de modo que
   * toda consulta analítica de B que las agrupara pasaba a fallar con `column ... does not exist`.
   * Una acción de un cliente degradaba el producto de otro.
   *
   * Un objeto compartido se deriva de datos compartidos. Las columnas salen ahora de TODAS las
   * dimensiones de la instalación, deduplicadas por el nombre de columna que producen, así que la
   * vista contiene la unión y ningún inquilino puede quitarle una columna a otro. El acceso sigue
   * acotado por el `WHERE organization_id` de `query`, y las columnas de dimensión ajenas salen
   * NULL para quien no las usa, que es lo que ya ocurría con una dimensión no informada.
   *
   * La ruta que llega aquí exige además un permiso de plataforma y un step-up de un solo uso
   * (`analytical-reporting.controller.ts`), porque esto destruye y recrea un objeto del que
   * depende el reporting de todos los clientes.
   *
   * `tenant-scope-guard-allow`: la lectura es deliberadamente de toda la instalación, y ese es
   * justo el arreglo — acotarla por inquilino es lo que producía el defecto descrito arriba.
   */
  async synchronizeView(): Promise<LocalizedMessage> {
    const dimensions = await this.dataSource.manager.find(Dimension);
    const viewName = this.VIEW_NAME;

    this.logger.log(`Iniciando sincronización de la vista materializada. ${dimensions.length} dimensiones encontradas en la instalación.`);


    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {

      await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS "${viewName}"`);


      // Una columna por NOMBRE DE COLUMNA distinto, no por fila de `dimensions`: dos inquilinos
      // que llaman igual a su centro de coste comparten la columna `cost_center`, y sin
      // deduplicar el `CREATE` fallaría con "column specified more than once".
      //
      // El nombre entra en DOS sitios y los dos se sanean. Antes solo se saneaba el alias:
      //
      //     `jel.dimensions ->> '${dim.name}' AS "${this.sanitizeColumnName(dim.name)}"`
      //                        ^^^^^^^^^^^^ crudo, dentro de un literal SQL
      //
      // Lo que impedía la inyección era que `sanitizeColumnName` lanzara al evaluar la MISMA
      // plantilla, antes de que la cadena llegara a `query()`. Funcionaba por el orden de
      // evaluación de un template literal, no por diseño: separar el alias del valor, o añadir
      // una columna sin alias, habría abierto el agujero sin que nada fallara. Ahora el literal
      // lleva su propio escapado y el DTO restringe el juego de caracteres (`CreateDimensionDto`).
      const seen = new Map<string, string>();
      for (const dim of dimensions) {
        const column = this.sanitizeColumnName(dim.name);
        if (!seen.has(column)) seen.set(column, dim.name);
      }

      const dynamicDimensionColumns = [...seen.entries()]
        .map(([column, rawName]) => `jel.dimensions ->> ${this.quoteLiteral(rawName)} AS "${column}"`)
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
      for (const column of seen.keys()) {
        await queryRunner.query(`CREATE INDEX ON "${viewName}" ("${column}");`);
      }

      await queryRunner.commitTransaction();
      this.logger.log(`Vista materializada "${viewName}" sincronizada exitosamente.`);
      return { messageKey: 'analytical_reporting.materialized_view_has_synchronized_rebuilt_with' };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Fallo la sincronización de la vista materializada.', (error as Error).stack);
      throw new BadRequestError('analytical_reporting.analytical_view_could_not_synchronized_p1', { p1: (error as Error).message });
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
          if (!Array.isArray(filter.value)) throw new BadRequestError('analytical_reporting.value_operator_must_array');
          qb.andWhere(`${sanitizedField} IN (:...${paramName})`, { [paramName]: filter.value });
          break;
        default:
          throw new BadRequestError('analytical_reporting.unsupported_filter_operator_operator', { operator: filter.operator });
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

  /**
   * Recalcula las filas. No cambia la forma de la vista.
   *
   * Devuelve un mensaje y ya no se traga el error en silencio: el controlador espera esta promesa,
   * así que un fallo llega al llamante como un 400 con su causa en lugar de quedar solo en un log
   * que nadie lee mientras la interfaz dice que todo fue bien.
   */
  async refreshMaterializedView(): Promise<LocalizedMessage> {
    this.logger.log('Refrescando la vista materializada de reportes analíticos...');
    try {
      await this.dataSource.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${this.VIEW_NAME}"`);
      this.logger.log('Vista materializada refrescada exitosamente.');
      return { messageKey: 'analytical_reporting.materialized_view_refreshed' };
    } catch (error) {
      this.logger.error('Fallo al refrescar la vista materializada. Puede que necesite ser recreada.', (error as Error).stack);
      throw new BadRequestError('analytical_reporting.analytical_view_could_not_synchronized_p1', {
        p1: (error as Error).message,
      });
    }
  }

  private sanitizeColumnName(name: string): string {
    if (!/^[a-zA-Z0-9_ ]+$/.test(name)) {
      throw new BadRequestError('analytical_reporting.dimension_field_name_contains_invalid_characters', { name });
    }
    return name.replace(/ /g, '_').toLowerCase();
  }

  /**
   * Un literal SQL, escapado.
   *
   * `->> 'nombre'` no admite un parámetro enlazado dentro de `CREATE MATERIALIZED VIEW` —la
   * definición de la vista se guarda expandida, no preparada—, así que el valor tiene que ir en el
   * texto. Que vaya escapado y no crudo es la diferencia entre una defensa y una coincidencia: el
   * DTO ya restringe el juego de caracteres, y esto sigue siendo correcto aunque alguien afloje
   * esa regla o llegue una fila escrita antes de que existiera.
   *
   * Duplicar la comilla simple es el escapado que define el estándar SQL para un literal, y es lo
   * que hace `quote_literal` de PostgreSQL.
   */
  private quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }
}