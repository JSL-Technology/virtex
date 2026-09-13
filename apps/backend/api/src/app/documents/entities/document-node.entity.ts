import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

export enum DocumentNodeKind {
  FOLDER = 'FOLDER',
  FILE = 'FILE',
}

/**
 * What a stored file is for, when it is a reusable model rather than a record.
 *
 * `NONE` is the ordinary case: a signed contract, a scanned bill, a photograph of a delivery.
 */
export enum DocumentTemplateType {
  NONE = 'NONE',
  INVOICE = 'INVOICE',
  QUOTE = 'QUOTE',
  EMAIL = 'EMAIL',
  CONTRACT = 'CONTRACT',
  OTHER = 'OTHER',
}

/**
 * One node of the tenant's document tree: a folder, or a file in one.
 *
 * ## Why one table for both
 *
 * A repository is a tree, and two tables mean two ways to ask "what is in this folder" - which
 * drift, and then a rename moves a file out of a folder that still lists it. `kind` says which a
 * row is, and the CHECK below is what stops a folder from acquiring a storage key or a file from
 * losing one.
 *
 * ## What existed
 *
 * Nothing. The repository screen listed two folders and four files - `Facturas de Proveedores,
 * 15 archivos`, `Reporte_Ventas_Q2_2025.pdf, 2.1 MB` - as literals in the browser bundle, the same
 * six rows for every tenant of the product, with an upload button that uploaded nothing and a
 * search box that filtered a list nobody could add to. The storage service they would have needed
 * had been there the whole time, serving avatars and journal-entry attachments.
 */
@Entity({ name: 'document_nodes' })
@Index('IDX_document_nodes_org_parent', ['organizationId', 'parentId'])
// Two files cannot share a name in one folder, which is what makes a path mean one thing. Scoped
// by tenant and parent; `parent_id IS NULL` is the root, and Postgres treats NULLs as distinct in
// a plain unique index, so the root needs its own partial index below.
@Index('UQ_document_nodes_folder_name', ['organizationId', 'parentId', 'name'], {
  unique: true,
  where: '"parent_id" IS NOT NULL',
})
@Index('UQ_document_nodes_root_name', ['organizationId', 'name'], {
  unique: true,
  where: '"parent_id" IS NULL',
})
@Check(
  'CHK_document_nodes_file_has_storage',
  `("kind" = 'FOLDER' AND "storage_key" IS NULL) OR ("kind" = 'FILE' AND "storage_key" IS NOT NULL)`,
)
export class DocumentNode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Null at the root. A folder cannot be its own ancestor; the service enforces that on move. */
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => DocumentNode, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id', foreignKeyConstraintName: 'FK_document_nodes_parent' })
  parent: DocumentNode | null;

  @Column({ type: 'enum', enum: DocumentNodeKind })
  kind: DocumentNodeKind;

  @Column({ length: 255 })
  name: string;

  /** What storage calls the object. Null on a folder, which has no bytes. */
  @Column({ name: 'storage_key', type: 'text', nullable: true })
  storageKey: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 255, nullable: true })
  mimeType: string | null;

  /** Bytes as stored. Numeric rather than int: a 3 GB video overflows a 32-bit integer. */
  @Column('decimal', {
    name: 'file_size',
    precision: 18,
    scale: 0,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  fileSize: number;

  /**
   * Whether this file is a reusable model, and of what.
   *
   * The templates screen listed three templates nobody could open, edit or replace. A template is
   * a file somebody uploaded and tagged; there is nothing else it could honestly be until the
   * product has a template *engine*, which it does not.
   */
  @Column({
    name: 'template_type',
    type: 'enum',
    enum: DocumentTemplateType,
    default: DocumentTemplateType.NONE,
  })
  templateType: DocumentTemplateType;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
