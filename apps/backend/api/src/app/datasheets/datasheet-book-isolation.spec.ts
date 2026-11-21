import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DatasheetsService } from './services/datasheets.service';
import { DatasheetBook } from './entities/datasheet-book.entity';
import { DatasheetSheet } from './entities/datasheet-sheet.entity';
import { DatasheetVersion } from './entities/datasheet-version.entity';
import { DatasheetPermission } from './entities/datasheet-permission.entity';
import { CreateDatasheetBookDto, UpdateDatasheetBookDto } from './dto/datasheet-book.dto';
import { createTestOrganization, describeWithDb, newId, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * Reproduced 2026-11-08 against the running API: `POST /datasheets` from tenant B with the `id` of a
 * book of tenant A answered 201 and the row now belonged to B — organization and owner rewritten,
 * sheets included. The body was `Partial<DatasheetBook>` (no DTO, so no whitelist) spread into
 * `create()`, and `save()` with an existing id is an UPDATE.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

describe('datasheet book DTOs', () => {
  it('refuse the columns a client must never write', async () => {
    for (const field of ['id', 'organizationId', 'ownerId', 'owner', 'organization']) {
      await expect(
        pipe.transform({ name: 'QA', [field]: 'x' }, { type: 'body', metatype: CreateDatasheetBookDto }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        pipe.transform({ [field]: 'x' }, { type: 'body', metatype: UpdateDatasheetBookDto }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('accept an ordinary book with sheets', async () => {
    await expect(
      pipe.transform({ name: 'QA', sheets: [{ name: 'Hoja 1', index: 0, cells: { A1: { v: 1 } } }] }, { type: 'body', metatype: CreateDatasheetBookDto }),
    ).resolves.toBeInstanceOf(CreateDatasheetBookDto);
  });
});

describeWithDb('datasheet books across tenants', () => {
  let ds: DataSource;
  let service: DatasheetsService;
  let orgA: string;
  let orgB: string;
  let userA: { id: string; organizationId: string };
  let userB: { id: string; organizationId: string };

  const member = async (organizationId: string) => {
    const id = await newId(ds);
    await ds.query(`INSERT INTO users (id, email, "firstName", "lastName", status) VALUES ($1, $2, 'QA', 'Sheets', 'ACTIVE')`, [id, `qa-sheets-${id}@virtex.test`]);
    await ds.query(`INSERT INTO user_organizations (user_id, organization_id) VALUES ($1, $2)`, [id, organizationId]);
    return { id, organizationId, permissions: ['*'] };
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    orgA = await createTestOrganization(ds, 'sheets-a');
    orgB = await createTestOrganization(ds, 'sheets-b');
    userA = await member(orgA);
    userB = await member(orgB);
    service = new DatasheetsService(
      ds.getRepository(DatasheetBook),
      ds.getRepository(DatasheetSheet),
      ds.getRepository(DatasheetVersion),
      ds.getRepository(DatasheetPermission),
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM datasheet_books WHERE organization_id IN ($1, $2)`, [orgA, orgB]);
    await ds.query(`DELETE FROM user_organizations WHERE user_id IN ($1, $2)`, [userA.id, userB.id]);
    await ds.query(`DELETE FROM organizations WHERE id IN ($1, $2)`, [orgA, orgB]);
    await ds.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userA.id, userB.id]);
    await ds.destroy();
  });

  it('creating never touches an existing book, whatever the payload carries', async () => {
    const victim = await service.create({ name: 'QA libro de A' } as CreateDatasheetBookDto, userA as never);
    // Even if a caller bypassed the DTO, the service copies columns one by one.
    await service.create({ name: 'QA intento de B', id: victim.id } as unknown as CreateDatasheetBookDto, userB as never);

    const [row] = await ds.query(`SELECT name, organization_id, "ownerId" FROM datasheet_books WHERE id = $1`, [victim.id]);
    expect(row).toEqual({ name: 'QA libro de A', organization_id: orgA, ownerId: userA.id });
  });

  it("an update cannot reach another book's sheet", async () => {
    const mine = await service.create({ name: 'QA mío' } as CreateDatasheetBookDto, userB as never);
    const theirs = await service.create({ name: 'QA de A' } as CreateDatasheetBookDto, userA as never);
    const theirSheet = theirs.sheets[0];
    await expect(
      service.update(mine.id, { sheets: [{ id: theirSheet.id, name: 'QA pisada', index: 0 }] } as UpdateDatasheetBookDto, userB as never),
    ).rejects.toMatchObject({ messageKey: 'datasheets.sheet_not_found' });
    const [sheet] = await ds.query(`SELECT name FROM datasheet_sheets WHERE id = $1`, [theirSheet.id]);
    expect(sheet.name).toBe(theirSheet.name);
  });

  it('a new book refuses sheets that name an id', async () => {
    await expect(
      service.create({ name: 'QA', sheets: [{ id: '00000000-0000-4000-8000-000000000001', name: 'x', index: 0 }] } as CreateDatasheetBookDto, userA as never),
    ).rejects.toMatchObject({ messageKey: 'datasheets.new_book_sheets_cannot_carry_ids' });
  });
});
