import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsOptional, validate } from 'class-validator';
import { SpreadsheetBoolean, UpperCaseCode, spreadsheetBoolean } from './spreadsheet-boolean.transformer';

class Row {
  @IsOptional()
  @SpreadsheetBoolean()
  @IsBoolean()
  flag?: boolean;

  @IsOptional()
  @UpperCaseCode()
  code?: string;
}

/** A yes/no cell, read as the person typed it rather than as «any text is true». */
describe('spreadsheet cells', () => {
  const read = (flag: unknown) => plainToInstance(Row, { flag }, { enableImplicitConversion: true }).flag;

  it('reads yes and no in the product’s languages, whatever the case', () => {
    for (const yes of ['true', 'TRUE', '1', 'yes', 'Sí', 'si', 'sim', 'Verdadero', 'verdadeiro', 'x', ' true ']) expect([yes, read(yes)]).toEqual([yes, true]);
    for (const no of ['false', 'FALSE', '0', 'no', 'No', 'não', 'nao', 'falso']) expect([no, read(no)]).toEqual([no, false]);
    expect(read(true)).toBe(true);
    expect(read(0)).toBe(false);
  });

  it('leaves anything else for the validator to refuse, instead of guessing', async () => {
    const row = plainToInstance(Row, { flag: 'quizás' }, { enableImplicitConversion: true });
    expect(row.flag).toBe('quizás');
    const [error] = await validate(row);
    expect(error.constraints).toHaveProperty('isBoolean');
    expect(spreadsheetBoolean({ value: undefined, key: 'flag', obj: {} })).toBeUndefined();
  });

  it('writes a code as the catalogue spells it', () => {
    expect(plainToInstance(Row, { code: ' asset ' }).code).toBe('ASSET');
  });
});
