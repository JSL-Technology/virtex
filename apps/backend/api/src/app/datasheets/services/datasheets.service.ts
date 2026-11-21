import { CreateDatasheetBookDto, DatasheetSheetInputDto, UpdateDatasheetBookDto } from '../dto/datasheet-book.dto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DatasheetBook, DatasheetMode } from '../entities/datasheet-book.entity';
import { DatasheetSheet } from '../entities/datasheet-sheet.entity';
import { DatasheetVersion } from '../entities/datasheet-version.entity';
import { DatasheetPermission, DatasheetAccessRole } from '../entities/datasheet-permission.entity';
import { User } from '../../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../../security/principal';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../i18n/localized.exception';

/** What each access role may do. Ordered from most to least. */
const CAN_EDIT = new Set([DatasheetAccessRole.OWNER, DatasheetAccessRole.EDITOR]);

/**
 * Spreadsheet books, and who may open them.
 *
 * ## What was wrong
 *
 * `findOne` looked a book up by id with **no `organizationId`**, and its access check was an empty
 * block:
 *
 * ```ts
 * if (book.ownerId !== user.id) {
 *    // Logic for shared permissions
 * }
 * ```
 *
 * So any authenticated user could read any spreadsheet in the deployment — another customer's
 * included — by guessing or enumerating a uuid, and `update` carried the same empty check, so they
 * could rewrite it too. `datasheet_permissions` existed, fully modelled, and was consulted nowhere.
 *
 * `findAll` had the same gap in a quieter form: it filtered on `ownerId` alone, so a book shared
 * with you never appeared in your own list — the sharing feature had a table, an enum, a foreign
 * key to `roles`, and no behaviour.
 */
@Injectable()
export class DatasheetsService {
  constructor(
    @InjectRepository(DatasheetBook)
    private bookRepo: Repository<DatasheetBook>,
    @InjectRepository(DatasheetSheet)
    private sheetRepo: Repository<DatasheetSheet>,
    @InjectRepository(DatasheetVersion)
    private versionRepo: Repository<DatasheetVersion>,
    @InjectRepository(DatasheetPermission)
    private permissionRepo: Repository<DatasheetPermission>
  ) {}

  /** Books this user owns, plus the ones actually shared with them. */
  async findAll(user: AuthenticatedUser): Promise<DatasheetBook[]> {
    const shared = await this.sharedBookIds(user);
    const query = this.bookRepo
      .createQueryBuilder('book')
      .where('book.organizationId = :organizationId', { organizationId: user.organizationId })
      .andWhere(
        shared.length > 0
          ? '(book.ownerId = :userId OR book.id IN (:...shared))'
          : 'book.ownerId = :userId',
        { userId: user.id, shared },
      )
      .orderBy('book.modifiedAt', 'DESC')
      // The owner's NAME for the list's «Propietario» column, and nothing else of the user row: no
      // e-mail, no status, nothing a colleague browsing shared books has reason to see.
      .leftJoin('book.owner', 'owner')
      .addSelect(['owner.id', 'owner.firstName', 'owner.lastName']);
    return query.getMany();
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<DatasheetBook> {
    // Scoped to the tenant in the LOOKUP, not in a check afterwards: a book of another
    // organization must be indistinguishable from one that does not exist.
    const book = await this.bookRepo.findOne({
      where: { id, organizationId: user.organizationId },
      relations: ['sheets'],
    });
    if (!book) {
      throw new NotFoundError('datasheets.datasheet_with_id_not_found', { id });
    }

    await this.requireAccess(book, user);
    return book;
  }

  /**
   * The access this user has to this book, or a refusal.
   *
   * A book is reachable by its owner, by anyone it was shared with directly, by anyone holding a
   * role it was shared with, and by anyone at all when it is marked public within the tenant.
   */
  private async accessFor(
    book: DatasheetBook,
    user: AuthenticatedUser,
  ): Promise<DatasheetAccessRole | null> {
    if (book.ownerId === user.id) return DatasheetAccessRole.OWNER;

    const roleIds = (user.roles ?? []).map((role: { id: string }) => role.id);
    const grants = await this.permissionRepo.find({ where: { bookId: book.id } });

    let best: DatasheetAccessRole | null = null;
    const rank = [
      DatasheetAccessRole.OWNER,
      DatasheetAccessRole.EDITOR,
      DatasheetAccessRole.COMMENTER,
      DatasheetAccessRole.READER,
    ];
    for (const grant of grants) {
      const applies =
        grant.isPublic ||
        grant.userId === user.id ||
        (grant.roleId != null && roleIds.includes(grant.roleId));
      if (!applies) continue;
      if (best === null || rank.indexOf(grant.role) < rank.indexOf(best)) best = grant.role;
    }
    return best;
  }

  private async requireAccess(
    book: DatasheetBook,
    user: AuthenticatedUser,
  ): Promise<DatasheetAccessRole> {
    const access = await this.accessFor(book, user);
    if (!access) {
      // Not found, not forbidden: telling a stranger that a book exists is itself a disclosure.
      throw new NotFoundError('datasheets.datasheet_with_id_not_found', { id: book.id });
    }
    return access;
  }

  private async sharedBookIds(user: AuthenticatedUser): Promise<string[]> {
    const roleIds = (user.roles ?? []).map((role: { id: string }) => role.id);
    const query = this.permissionRepo
      .createQueryBuilder('grant')
      .innerJoin(DatasheetBook, 'book', 'book.id = grant.bookId')
      .select('grant.bookId', 'bookId')
      .where('book.organizationId = :organizationId', { organizationId: user.organizationId })
      .andWhere(
        roleIds.length > 0
          ? '(grant.isPublic = true OR grant.userId = :userId OR grant.roleId IN (:...roleIds))'
          : '(grant.isPublic = true OR grant.userId = :userId)',
        { userId: user.id, roleIds },
      );
    const rows = await query.getRawMany<{ bookId: string }>();
    return [...new Set(rows.map((row) => row.bookId))];
  }

  /**
   * Create a book in the caller's tenant.
   *
   * Columns are copied one by one from the DTO, never spread: `create({ ...body }) + save()` with an
   * `id` in the body UPDATED that row — another tenant's book included — and stamped it with the
   * caller's organization and owner, moving it across tenants. A new book cannot carry ids of any kind.
   */
  async create(data: CreateDatasheetBookDto, user: AuthenticatedUser): Promise<DatasheetBook> {
    if (data.sheets?.some((sheet) => sheet.id)) {
      throw new BadRequestError('datasheets.new_book_sheets_cannot_carry_ids');
    }
    const savedBook = await this.bookRepo.manager.transaction(async (manager) => {
      const book = await manager.save(
        manager.create(DatasheetBook, {
          name: data.name,
          description: data.description,
          mode: data.mode,
          tags: data.tags,
          ownerId: user.id,
          organizationId: user.organizationId,
        }),
      );
      const sheets = data.sheets?.length ? data.sheets : [{ name: 'Hoja 1', index: 0 }];
      for (const sheet of sheets) {
        await manager.save(manager.create(DatasheetSheet, { ...sheetColumns(sheet), bookId: book.id }));
      }
      return book;
    });
    return this.findOne(savedBook.id, user);
  }

  async update(
    id: string,
    data: UpdateDatasheetBookDto,
    user: AuthenticatedUser,
  ): Promise<DatasheetBook> {
    const book = await this.findOne(id, user);
    const access = await this.requireAccess(book, user);
    if (!CAN_EDIT.has(access)) {
      throw new ForbiddenError('datasheets.you_do_not_have_permission_edit', { id });
    }

    await this.bookRepo.manager.transaction(async (manager) => {
      for (const sheet of data.sheets ?? []) {
        if (sheet.id) {
          // Scoped to this book: a sheet id from another book (or tenant) matches nothing.
          const result = await manager.update(DatasheetSheet, { id: sheet.id, bookId: id }, sheetColumns(sheet));
          if (!result.affected) throw new NotFoundError('datasheets.sheet_not_found', { id: sheet.id });
        } else {
          await manager.save(manager.create(DatasheetSheet, { ...sheetColumns(sheet), bookId: id }));
        }
      }
      // Only the book's own editable columns; tenant, owner and id are not reachable from here.
      const columns: Partial<DatasheetBook> = {};
      if (data.name !== undefined) columns.name = data.name;
      if (data.description !== undefined) columns.description = data.description;
      if (data.mode !== undefined) columns.mode = data.mode;
      if (data.tags !== undefined) columns.tags = data.tags;
      if (Object.keys(columns).length) await manager.update(DatasheetBook, { id, organizationId: user.organizationId }, columns);
    });
    return this.findOne(id, user);
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const book = await this.findOne(id, user);
    if (book.ownerId !== user.id) {
      throw new ForbiddenError('datasheets.only_owner_can_delete_this_document');
    }
    await this.bookRepo.remove(book);
  }

  async createVersion(id: string, comment: string, user: AuthenticatedUser): Promise<DatasheetVersion> {
    const book = await this.findOne(id, user);

    const lastVersion = await this.versionRepo.findOne({
      where: { bookId: id },
      order: { versionNumber: 'DESC' }
    });

    const nextVersionNumber = (lastVersion?.versionNumber || 0) + 1;

    const version = this.versionRepo.create({
      bookId: id,
      versionNumber: nextVersionNumber,
      comment,
      state: {
        sheets: book.sheets,
        mode: book.mode
      },
      createdById: user.id
    });

    return this.versionRepo.save(version);
  }

  async getVersions(id: string, user: AuthenticatedUser): Promise<DatasheetVersion[]> {
    await this.findOne(id, user);
    return this.versionRepo.find({
      where: { bookId: id },
      order: { versionNumber: 'DESC' }
    });
  }
}

/** The columns a client may write on a sheet. */
function sheetColumns(sheet: DatasheetSheetInputDto | { name: string; index: number }): Partial<DatasheetSheet> {
  const input = sheet as DatasheetSheetInputDto;
  const columns: Partial<DatasheetSheet> = { name: input.name, index: input.index };
  if (input.protected !== undefined) columns.protected = input.protected;
  if (input.cells !== undefined) columns.cells = input.cells as Record<string, unknown> as never;
  if (input.conditionalFormats !== undefined) columns.conditionalFormats = input.conditionalFormats as never;
  if (input.charts !== undefined) columns.charts = input.charts as never;
  if (input.namedRanges !== undefined) columns.namedRanges = input.namedRanges as never;
  return columns;
}
