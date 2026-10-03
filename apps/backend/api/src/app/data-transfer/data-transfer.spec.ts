import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { DataTransferDataset } from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../common/database/testing/integration-db';
import { BadRequestError } from '../i18n/localized.exception';
import { I18nService } from '../i18n/i18n.service';
import { AuthenticatedUser } from '../security/principal';
import { DataTransferService } from './data-transfer.service';
import { DataTransferRun, DataTransferStatus } from './entities/data-transfer-run.entity';

class ContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  code?: string;
}

/**
 * Export and import (QA A-10): the screens were a mock with a hard-coded history and buttons on a
 * timer. These pin what the real thing promises.
 */
describeWithDb('data transfer', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let organizationId: string;
  let service: DataTransferService;
  let stored: ContactDto[];
  const existing = new Set(['TAKEN']);

  const user = (permissions: string[]): AuthenticatedUser => ({
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ana@example.test',
    firstName: 'Ana',
    lastName: 'Pérez',
    organizationId,
    roles: [],
    permissions,
  });
  const admin = () => user(['contacts:view', 'contacts:create']);

  const dataset: DataTransferDataset<ContactDto> = {
    id: 'contacts',
    labelKey: 'data_transfer.datasets.contacts',
    viewPermission: 'contacts:view',
    columns: [
      { key: 'nombre', property: 'name', required: true, example: 'Ana' },
      { key: 'correo', property: 'email', example: 'ana@example.test' },
      { key: 'codigo', property: 'code', example: 'C-1' },
    ],
    exportPage: async (_org, take, skip) => ({
      rows: [
        { name: '=HYPERLINK("http://evil")', email: 'x@example.test', code: '-500' },
        { name: 'Comas, "y" comillas', email: null, code: 'C-2' },
      ].slice(skip, skip + take),
      total: 2,
    }),
    import: {
      createPermission: 'contacts:create',
      dto: ContactDto,
      uniqueBy: 'codigo',
      exists: async (value) => existing.has(value.toUpperCase()),
      check: async (dto) => {
        if (dto.name === 'Prohibido') throw new BadRequestError('contacts.name_not_allowed');
      },
      create: async (dto) => {
        stored.push(dto);
      },
    },
  };

  const csv = (text: string) => ({ originalname: 'contactos.csv', mimetype: 'text/csv', buffer: Buffer.from(text, 'utf-8') });

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'Transferencia');
    const registry = new DataTransferRegistry();
    registry.register(dataset as DataTransferDataset);
    service = new DataTransferService(registry, dataSource.getRepository(DataTransferRun), new I18nService());
  });

  beforeEach(() => {
    stored = [];
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  it('imports nothing when any row fails, and names every problem by line and column', async () => {
    const report = await service.import(
      admin(),
      'contacts',
      csv('nombre,correo,codigo\nAna,ana@example.test,C-1\n,no-es-correo,C-2\nLuis,,c-1\nMara,,taken\nProhibido,,C-9\n'),
      'commit',
    );

    expect(report.status).toBe(DataTransferStatus.FAILED);
    expect(report.importedRows).toBe(0);
    expect(stored).toEqual([]);
    const at = (row: number, column?: string) =>
      report.problems.filter((p) => p.row === row && (column === undefined || p.column === column));
    expect(at(3, 'nombre').length).toBeGreaterThan(0);
    expect(at(3, 'correo').length).toBeGreaterThan(0);
    expect(at(4, 'codigo')[0]).toMatchObject({ key: 'data_transfer.duplicate_in_file', params: { first: 2 } });
    expect(at(5, 'codigo')[0]).toMatchObject({ key: 'data_transfer.already_exists' });
    expect(at(6)[0]).toMatchObject({ key: 'contacts.name_not_allowed' });
    expect(report.failedRows).toBe(5 - 1);
  });

  it('validates without writing, then commits the same file', async () => {
    const file = csv('nombre;correo;codigo\nAna;ana@example.test;C-1\nLuis;luis@example.test;C-2\n');

    const checked = await service.import(admin(), 'contacts', file, 'validate');
    expect(checked).toMatchObject({ status: DataTransferStatus.VALIDATED, totalRows: 2, importedRows: 0 });
    expect(stored).toEqual([]);

    const committed = await service.import(admin(), 'contacts', file, 'commit');
    expect(committed).toMatchObject({ status: DataTransferStatus.COMPLETED, importedRows: 2 });
    expect(stored.map((dto) => dto.name)).toEqual(['Ana', 'Luis']);
  });

  it('refuses a file with unknown or missing columns before reading any row', async () => {
    const report = await service.import(admin(), 'contacts', csv('correo,telefono\na@example.test,1\n'), 'commit');
    expect(report.problems.map((p) => p.key)).toEqual(
      expect.arrayContaining(['data_transfer.unknown_columns', 'data_transfer.missing_columns']),
    );
  });

  it('reads an Excel file the same way', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Hoja');
    sheet.addRow(['nombre', 'codigo']);
    sheet.addRow(['Rosa', 'X-1']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const report = await service.import(
      admin(),
      'contacts',
      { originalname: 'contactos.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer },
      'commit',
    );
    expect(report.status).toBe(DataTransferStatus.COMPLETED);
    expect(stored).toEqual([expect.objectContaining({ name: 'Rosa', code: 'X-1' })]);
  });

  it('exports a CSV a spreadsheet cannot be tricked by', async () => {
    const file = await service.export(admin(), 'contacts', 'csv');
    const text = file.body.toString('utf-8');

    expect(text.startsWith('\uFEFFnombre,correo,codigo\r\n')).toBe(true);
    // A formula is text; a negative number stays a number.
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).toContain(',-500\r\n');
    expect(text).toContain('"Comas, ""y"" comillas",,C-2');
  });

  it('requires the permissions a person would need by hand', async () => {
    await expect(service.export(user([]), 'contacts', 'csv')).rejects.toMatchObject({
      messageKey: 'data_transfer.not_allowed_to_export',
    });
    await expect(service.import(user(['contacts:view']), 'contacts', csv('nombre\nAna\n'), 'commit')).rejects.toMatchObject(
      { messageKey: 'data_transfer.not_allowed_to_import' },
    );
    expect(service.datasets(user(['contacts:view']))).toEqual([
      expect.objectContaining({ id: 'contacts', importable: false }),
    ]);
  });

  it('keeps a real history: who, what and how it went', async () => {
    await service.export(admin(), 'contacts', 'xlsx');
    const runs = await service.recentRuns(admin());
    expect(runs[0]).toMatchObject({ kind: 'EXPORT', dataset: 'contacts', format: 'xlsx', userName: 'Ana Pérez', totalRows: 2 });
    expect(runs.some((run) => run.kind === 'IMPORT' && run.status === DataTransferStatus.FAILED)).toBe(true);
  });
});
