
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DatasheetBook, DatasheetMode } from '../entities/datasheet-book.entity';
import { DatasheetSheet } from '../entities/datasheet-sheet.entity';
import { DatasheetVersion } from '../entities/datasheet-version.entity';
import { DatasheetPermission, DatasheetAccessRole } from '../entities/datasheet-permission.entity';
import { User } from '../../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ForbiddenError, NotFoundError } from '../../i18n/localized.exception';

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
      .orderBy('book.modifiedAt', 'DESC');
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
      throw new NotFoundError('DATASHEETS.DATASHEET_WITH_ID_NOT_FOUND', { id });
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
      throw new NotFoundError('DATASHEETS.DATASHEET_WITH_ID_NOT_FOUND', { id: book.id });
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

  async create(data: Partial<DatasheetBook>, user: AuthenticatedUser): Promise<DatasheetBook> {
    const book = this.bookRepo.create({
      ...data,
      ownerId: user.id,
      organizationId: user.organizationId
    });

    const savedBook = await this.bookRepo.save(book);

    // Create default sheet if none provided
    if (!data.sheets || data.sheets.length === 0) {
      const sheet = this.sheetRepo.create({
        name: 'Hoja 1',
        index: 0,
        bookId: savedBook.id
      });
      await this.sheetRepo.save(sheet);
    }

    return this.findOne(savedBook.id, user);
  }

  async update(
    id: string,
    data: Partial<DatasheetBook>,
    user: AuthenticatedUser,
  ): Promise<DatasheetBook> {
    const book = await this.findOne(id, user);
    const access = await this.requireAccess(book, user);
    if (!CAN_EDIT.has(access)) {
      throw new ForbiddenError('DATASHEETS.SIN_PERMISO_EDICION', { id });
    }

    // The tenant and the owner are not editable through this route: a book cannot be moved to
    // another organization, and `bookRepo.update(id, data)` used to write whatever the body said.
    delete (data as Partial<DatasheetBook>).organizationId;
    delete (data as Partial<DatasheetBook>).ownerId;

    if (data.sheets) {
      // Handle sheet updates/sync
      for (const sheetData of data.sheets) {
        if (sheetData.id) {
          // Scoped to this book: `update(sheetData.id, …)` alone let a caller rewrite a sheet of
          // any book in the deployment by naming its id in the body.
          await this.sheetRepo.update({ id: sheetData.id, bookId: id }, sheetData);
        } else {
          const newSheet = this.sheetRepo.create({ ...sheetData, bookId: id });
          await this.sheetRepo.save(newSheet);
        }
      }
      delete data.sheets;
    }

    await this.bookRepo.update(id, data);
    return this.findOne(id, user);
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const book = await this.findOne(id, user);
    if (book.ownerId !== user.id) {
      throw new ForbiddenError('DATASHEETS.ONLY_OWNER_CAN_DELETE_THIS_DOCUMENT');
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
