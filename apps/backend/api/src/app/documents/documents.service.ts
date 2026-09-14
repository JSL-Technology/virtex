import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, IsNull, Not, Repository } from 'typeorm';
import {
  DocumentNode,
  DocumentNodeKind,
  DocumentTemplateType,
} from './entities/document-node.entity';
import {
  CreateFolderDto,
  ListDocumentsDto,
  MoveDocumentDto,
  RenameDocumentDto,
  UpdateDocumentDto,
} from './dto/documents.dto';
import { StorageService, StoredFileStream, UploadableFile } from '../storage/storage.service';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { Page, resolvePaging, toPage } from '../common/pagination';

/** How deep a folder tree may go. A path nobody can read is a path nobody can navigate. */
const MAX_DEPTH = 20;

/**
 * The tenant's document repository.
 *
 * ## What existed
 *
 * Nothing behind the screen. It listed two folders and four files as literals in the browser
 * bundle — the same six rows for every tenant of the product — with an upload button that uploaded
 * nothing and a search box that filtered a list nobody could add to. The storage service it needed
 * had been there the whole time, serving avatars and journal-entry attachments.
 *
 * ## What the tree guarantees
 *
 * Every read and every write is scoped to the caller's tenant, including the parent a node is
 * placed under: a folder id from another tenant resolves to "not found" rather than to somebody
 * else's filing cabinet. Names are unique within a folder, so a path means one thing. And deleting
 * a folder deletes its objects from storage, not only its rows — an orphaned object is a
 * confidential file nobody can see and nobody can delete.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(DocumentNode)
    private readonly nodes: Repository<DocumentNode>,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * What is in one folder — or, when a search term is given, what matches anywhere in the tree.
   *
   * Folders first, then files, each alphabetically: the order every file manager uses, and the one
   * that puts what a reader is navigating through above what they are looking for.
   */
  async list(organizationId: string, query: ListDocumentsDto): Promise<Page<DocumentNode>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const searching = Boolean(query.search?.trim());

    const [rows, total] = await this.nodes.findAndCount({
      where: {
        organizationId,
        // A search spans the tree; without one the listing is the contents of one folder.
        ...(searching
          ? { name: ILike(`%${query.search!.trim()}%`) }
          : { parentId: query.parentId ? query.parentId : IsNull() }),
        ...(query.templateType ? { templateType: query.templateType } : {}),
        ...(query.templatesOnly ? { templateType: Not(DocumentTemplateType.NONE) } : {}),
      },
      order: { kind: 'ASC', name: 'ASC' },
      skip: paging.skip,
      take: paging.take,
    });
    return toPage(rows, total, paging);
  }

  async findOne(id: string, organizationId: string): Promise<DocumentNode> {
    const node = await this.nodes.findOneBy({ id, organizationId });
    if (!node) throw new NotFoundError('documents.not_found', { id });
    return node;
  }

  /**
   * The chain of folders from the root down to this node.
   *
   * Returned as data rather than as a rendered string, so the client can make each level clickable
   * — which is the only thing a breadcrumb is for.
   */
  async breadcrumb(id: string, organizationId: string): Promise<DocumentNode[]> {
    const trail: DocumentNode[] = [];
    let current: DocumentNode | null = await this.findOne(id, organizationId);

    for (let depth = 0; current && depth <= MAX_DEPTH; depth += 1) {
      trail.unshift(current);
      current = current.parentId
        ? await this.nodes.findOneBy({ id: current.parentId, organizationId })
        : null;
    }
    return trail;
  }

  async createFolder(
    dto: CreateFolderDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<DocumentNode> {
    const parentId = await this.resolveParent(dto.parentId, organizationId);
    await this.assertNameFree(organizationId, parentId, dto.name.trim());

    return this.nodes.save(
      this.nodes.create({
        organizationId,
        parentId,
        kind: DocumentNodeKind.FOLDER,
        name: dto.name.trim(),
        storageKey: null,
        mimeType: null,
        fileSize: 0,
        templateType: DocumentTemplateType.NONE,
        createdByUserId: actorUserId,
      }),
    );
  }

  /**
   * Store a file and record it in the tree.
   *
   * The bytes go to storage first: a row pointing at an object that failed to upload is a file the
   * repository claims to have and cannot produce. If the row then fails — a duplicate name, say —
   * the object is deleted again rather than left orphaned.
   */
  async upload(
    file: UploadableFile,
    options: {
      parentId?: string;
      templateType?: DocumentTemplateType;
      description?: string;
    },
    organizationId: string,
    actorUserId: string,
  ): Promise<DocumentNode> {
    const parentId = await this.resolveParent(options.parentId, organizationId);
    const name = file.fileName.trim();
    if (!name) throw new BadRequestError('documents.name_required');
    await this.assertNameFree(organizationId, parentId, name);

    // Per tenant, so one tenant's objects are never in another's prefix.
    const stored = await this.storage.upload(file, `documents/${organizationId}`);

    try {
      return await this.nodes.save(
        this.nodes.create({
          organizationId,
          parentId,
          kind: DocumentNodeKind.FILE,
          name,
          storageKey: stored.storageKey,
          mimeType: stored.mimeType,
          fileSize: stored.fileSize,
          templateType: options.templateType ?? DocumentTemplateType.NONE,
          description: options.description ?? null,
          createdByUserId: actorUserId,
        }),
      );
    } catch (error) {
      await this.storage.delete(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async rename(
    id: string,
    dto: RenameDocumentDto,
    organizationId: string,
  ): Promise<DocumentNode> {
    const node = await this.findOne(id, organizationId);
    const name = dto.name.trim();
    if (name !== node.name) {
      await this.assertNameFree(organizationId, node.parentId, name);
      node.name = name;
      await this.nodes.save(node);
    }
    return node;
  }

  /** Move a node into another folder, or to the root. */
  async move(id: string, dto: MoveDocumentDto, organizationId: string): Promise<DocumentNode> {
    const node = await this.findOne(id, organizationId);
    const parentId = await this.resolveParent(dto.parentId, organizationId);

    if (parentId === node.id) throw new BadRequestError('documents.cannot_move_into_itself');
    if (parentId && (await this.isDescendant(parentId, node.id, organizationId))) {
      // Moving a folder into its own subtree detaches it from the root: it and everything under it
      // become unreachable while still occupying storage.
      throw new BadRequestError('documents.folder_cannot_moved_into_one_own');
    }

    await this.assertNameFree(organizationId, parentId, node.name, node.id);
    node.parentId = parentId;
    return this.nodes.save(node);
  }

  async update(
    id: string,
    dto: UpdateDocumentDto,
    organizationId: string,
  ): Promise<DocumentNode> {
    const node = await this.findOne(id, organizationId);
    if (node.kind !== DocumentNodeKind.FILE && dto.templateType) {
      throw new BadRequestError('documents.folder_is_not_a_template');
    }
    if (dto.templateType !== undefined) node.templateType = dto.templateType;
    if (dto.description !== undefined) node.description = dto.description;
    return this.nodes.save(node);
  }

  /** The bytes, streamed. Used to serve a download without holding the file in memory. */
  async stream(id: string, organizationId: string): Promise<{ node: DocumentNode; file: StoredFileStream }> {
    const node = await this.findOne(id, organizationId);
    if (node.kind !== DocumentNodeKind.FILE || !node.storageKey) {
      throw new BadRequestError('documents.folder_has_no_content');
    }
    return { node, file: await this.storage.getStream(node.storageKey) };
  }

  /**
   * Delete a node, and everything under it.
   *
   * The rows go through the database's own `ON DELETE CASCADE`; the *objects* are deleted here,
   * one by one, because storage knows nothing about the tree. An orphaned object is a confidential
   * file nobody can see and nobody can delete.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    const node = await this.findOne(id, organizationId);
    const keys = await this.storageKeysUnder(node, organizationId);

    await this.nodes.delete({ id: node.id, organizationId });

    for (const key of keys) {
      // A failure here leaves an object behind but the tree correct, which is the better of the
      // two failures: the alternative is a row pointing at bytes that are already gone.
      await this.storage.delete(key).catch((error: Error) => {
        this.logger.warn(`No se pudo borrar el objeto ${key}: ${error.message}`);
      });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** A parent id is only a parent when it is a folder, in this tenant. */
  private async resolveParent(
    parentId: string | undefined,
    organizationId: string,
  ): Promise<string | null> {
    if (!parentId) return null;
    const parent = await this.nodes.findOneBy({ id: parentId, organizationId });
    if (!parent) throw new NotFoundError('documents.folder_not_found', { id: parentId });
    if (parent.kind !== DocumentNodeKind.FOLDER) {
      throw new BadRequestError('documents.parent_is_not_a_folder');
    }
    return parent.id;
  }

  private async assertNameFree(
    organizationId: string,
    parentId: string | null,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.nodes.findOne({
      where: {
        organizationId,
        parentId: parentId ?? IsNull(),
        name,
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    if (clash) throw new BadRequestError('documents.name_already_exists_folder', { name });
  }

  private async isDescendant(
    candidateId: string,
    ancestorId: string,
    organizationId: string,
  ): Promise<boolean> {
    let current: DocumentNode | null = await this.nodes.findOneBy({
      id: candidateId,
      organizationId,
    });
    for (let depth = 0; current && depth <= MAX_DEPTH; depth += 1) {
      if (current.parentId === ancestorId) return true;
      current = current.parentId
        ? await this.nodes.findOneBy({ id: current.parentId, organizationId })
        : null;
    }
    return false;
  }

  /** Every storage key in the subtree rooted at `node`, in one recursive query. */
  private async storageKeysUnder(
    node: DocumentNode,
    organizationId: string,
  ): Promise<string[]> {
    if (node.kind === DocumentNodeKind.FILE) {
      return node.storageKey ? [node.storageKey] : [];
    }

    const rows: { storage_key: string }[] = await this.dataSource.query(
      `WITH RECURSIVE subtree AS (
         SELECT "id", "storage_key"
           FROM "document_nodes"
          WHERE "id" = $1 AND "organization_id" = $2
         UNION ALL
         SELECT child."id", child."storage_key"
           FROM "document_nodes" child
           JOIN subtree ON child."parent_id" = subtree."id"
          WHERE child."organization_id" = $2
       )
       SELECT "storage_key" FROM subtree WHERE "storage_key" IS NOT NULL`,
      [node.id, organizationId],
    );
    return rows.map((row) => row.storage_key);
  }
}
