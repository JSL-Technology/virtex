/**
 * Un doble del `QueryBuilder` de TypeORM que anota lo que se le pidió.
 *
 * Los catálogos que un selector de entidades puede consultar —productos, proveedores, clientes,
 * cuentas— comparten forma de búsqueda: filtro de inquilino primero, término opcional después,
 * tope al final. Lo que hay que comprobar de cada uno es la parte que el cliente no puede
 * comprobar, y eso se ve en las cláusulas que llegan al constructor de la consulta.
 *
 * Vive aquí, junto a `likeTerm`, porque es del mismo asunto y porque así cada módulo lo importa
 * hacia la plataforma —la dirección que las fronteras permiten— en vez de que la plataforma
 * importe los módulos.
 */
export interface RecordedClause {
  clause: string;
  parameters?: Record<string, unknown>;
}

export interface QueryBuilderSpy {
  /** Las cláusulas recibidas, en orden: `where` primero, cada `andWhere` después. */
  readonly calls: RecordedClause[];
  /** Los topes aplicados con `take`. Vacío significa «sin tope», que es lo que hacía antes. */
  readonly taken: number[];
  /** Las relaciones traídas con `leftJoinAndSelect`. */
  readonly joined: string[];
  /** Lo que se le pasa al servicio en lugar del repositorio. */
  readonly repository: { createQueryBuilder: () => unknown };
}

export function queryBuilderSpy(): QueryBuilderSpy {
  const calls: RecordedClause[] = [];
  const taken: number[] = [];
  const joined: string[] = [];

  const query = {
    where: (clause: string, parameters?: Record<string, unknown>) => {
      calls.push({ clause, parameters });
      return query;
    },
    andWhere: (clause: string, parameters?: Record<string, unknown>) => {
      calls.push({ clause, parameters });
      return query;
    },
    leftJoinAndSelect: (relation: string) => {
      joined.push(relation);
      return query;
    },
    orderBy: () => query,
    take: (limit: number) => {
      taken.push(limit);
      return query;
    },
    getMany: () => Promise.resolve([]),
  };

  return { calls, taken, joined, repository: { createQueryBuilder: () => query } };
}
