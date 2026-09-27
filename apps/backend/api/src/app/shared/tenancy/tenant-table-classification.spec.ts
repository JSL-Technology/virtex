import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CLASSIFIED_TABLE_NAMES,
  CROSS_TENANT_TABLES,
  GLOBAL_TABLES,
  INHERITED_TENANT_TABLES,
  MATERIALIZED_VIEWS,
} from './tenant-table-classification';

/**
 * La clasificación es el control, así que tiene que ser internamente consistente.
 *
 * `verify:rls` la contrasta contra una base de datos real; esto comprueba lo que no necesita base:
 * que ninguna tabla esté en dos listas a la vez, que cada entrada diga POR QUÉ, y que la copia de
 * la lista de hijas que vive en la migración no se separe de la de aquí — que es la única razón
 * por la que se tolera que esté escrita dos veces.
 */
describe('la clasificación de tablas por inquilino', () => {
  it('no clasifica ninguna tabla en dos sitios a la vez', () => {
    const all = [
      ...INHERITED_TENANT_TABLES.map((t) => t.table),
      ...GLOBAL_TABLES.map((t) => t.table),
      ...CROSS_TENANT_TABLES.map((t) => t.table),
    ];
    const duplicates = all.filter((table, index) => all.indexOf(table) !== index);
    expect(duplicates).toEqual([]);
    expect(CLASSIFIED_TABLE_NAMES.size).toBe(all.length);
  });

  /**
   * Una entrada sin motivo es una lista que deja de leerse. El motivo es lo que convierte
   * «no está protegida» en una decisión que alguien firmó.
   */
  it('cada entrada dice por qué', () => {
    const silent = [...INHERITED_TENANT_TABLES, ...GLOBAL_TABLES, ...CROSS_TENANT_TABLES]
      .filter((entry) => !entry.why || entry.why.trim().length < 10)
      .map((entry) => entry.table);
    expect(silent).toEqual([]);
  });

  it('cada hija nombra su padre y la columna que los une', () => {
    const malformed = INHERITED_TENANT_TABLES.filter(
      (entry) => !entry.parent || !entry.foreignKey,
    ).map((entry) => entry.table);
    expect(malformed).toEqual([]);
  });

  it('cada vista materializada declara la columna de inquilino que hay que filtrar', () => {
    const malformed = MATERIALIZED_VIEWS.filter((v) => !v.view || !v.tenantColumn).map((v) => v.view);
    expect(malformed).toEqual([]);
  });

  /**
   * La migración `1789006700000` repite la lista de hijas que añade, porque corre bajo
   * `typeorm-ts-node` con su propio tsconfig y no puede importar de `app/`. Esa copia solo es
   * aceptable mientras algo compruebe que no envejece.
   */
  it('la copia de la migración no se separa de esta lista', () => {
    const migration = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'database',
        'migrations',
        '1789006700000-CompleteTenantIsolationCoverage.ts',
      ),
      'utf8',
    );

    const block = migration.slice(
      migration.indexOf('missingChildren'),
      migration.indexOf('];', migration.indexOf('missingChildren')),
    );

    const declaredInMigration = [...block.matchAll(/\['([a-z_]+)',\s*'([a-z_]+)'/g)].map(
      (match) => match[1],
    );

    expect(declaredInMigration.length).toBeGreaterThan(0);

    for (const table of declaredInMigration) {
      expect(CLASSIFIED_TABLE_NAMES.has(table)).toBe(true);
      const entry = INHERITED_TENANT_TABLES.find((t) => t.table === table);
      expect(entry).toBeDefined();
    }
  });
});
