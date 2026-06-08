
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DatasheetBook, DatasheetMode } from '../entities/datasheet-book.entity';
import { DatasheetSheet } from '../entities/datasheet-sheet.entity';
import { DatasheetVersion } from '../entities/datasheet-version.entity';
import { DatasheetPermission, DatasheetAccessRole } from '../entities/datasheet-permission.entity';
import { User } from '../../users/entities/user.entity/user.entity';

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

  async findAll(user: User): Promise<DatasheetBook[]> {
    return this.bookRepo.find({
      where: [
        { ownerId: user.id },
        // Add logic for shared with user or role later
      ],
      order: { modifiedAt: 'DESC' }
    });
  }

  async findOne(id: string, user: User): Promise<DatasheetBook> {
    const book = await this.bookRepo.findOne({
      where: { id },
      relations: ['sheets']
    });

    if (!book) {
      throw new NotFoundException(`Datasheet with ID ${id} not found`);
    }

    // Check permissions
    if (book.ownerId !== user.id) {
       // Logic for shared permissions
    }

    return book;
  }

  async create(data: Partial<DatasheetBook>, user: User): Promise<DatasheetBook> {
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

  async update(id: string, data: Partial<DatasheetBook>, user: User): Promise<DatasheetBook> {
    const book = await this.findOne(id, user);

    // Authorization check
    if (book.ownerId !== user.id) {
       // Check if editor
    }

    if (data.sheets) {
      // Handle sheet updates/sync
      for (const sheetData of data.sheets) {
        if (sheetData.id) {
          await this.sheetRepo.update(sheetData.id, sheetData);
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

  async remove(id: string, user: User): Promise<void> {
    const book = await this.findOne(id, user);
    if (book.ownerId !== user.id) {
      throw new ForbiddenException('Only the owner can delete this document');
    }
    await this.bookRepo.remove(book);
  }

  async createVersion(id: string, comment: string, user: User): Promise<DatasheetVersion> {
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

  async getVersions(id: string, user: User): Promise<DatasheetVersion[]> {
    await this.findOne(id, user);
    return this.versionRepo.find({
      where: { bookId: id },
      order: { versionNumber: 'DESC' }
    });
  }
}
