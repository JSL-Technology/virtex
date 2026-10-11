import { returnedRows } from './returned-rows';

/** What TypeORM's Postgres driver hands back from `manager.query`, by statement. */
const UPDATE = <T>(rows: T[]) => [rows, rows.length] as const;
const INSERT = <T>(rows: T[]) => rows;

describe('returnedRows', () => {
  it('reads the rows of an UPDATE / DELETE, which come as [rows, affected]', () => {
    expect(returnedRows(UPDATE([{ id: 'a' }]))).toEqual([{ id: 'a' }]);
    expect(returnedRows(UPDATE([]))).toEqual([]);
  });

  it('reads the rows of an INSERT / SELECT, which come as the rows themselves', () => {
    expect(returnedRows(INSERT([{ id: 'a' }, { id: 'b' }]))).toHaveLength(2);
    expect(returnedRows(undefined)).toEqual([]);
  });
});
