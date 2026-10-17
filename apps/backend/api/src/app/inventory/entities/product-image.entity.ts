import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { Product } from './product.entity';

/**
 * A photo of a product, as stored.
 *
 * The object is recorded by its storage key, never by URL: on a private bucket the URL is signed
 * and expires, so a URL saved here would be a broken image a few minutes later.
 *
 * `productId` is nullable because a photo exists before its product does — the "create from photo"
 * flow uploads first, proposes the fields, and only then creates the product, which claims the
 * image. An image nobody claims is an abandoned draft.
 *
 * `sha256` identifies the bytes: the same picture uploaded twice is recognised without asking any
 * model, and the analysis of a photo can be reused rather than paid for again.
 */
@Entity({ name: 'product_images' })
@Index('IDX_product_images_org_product', ['organizationId', 'productId'])
export class ProductImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_product_images_organization')
  organization?: TenantRef;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne('Product', { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_product_images_product' })
  product?: Product | null;

  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 64 })
  mimeType: string;

  @Column({ name: 'file_size', type: 'integer' })
  fileSize: number;

  @Column({ type: 'integer', nullable: true })
  width: number | null;

  @Column({ type: 'integer', nullable: true })
  height: number | null;

  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @Column({ name: 'uploaded_by_user_id', type: 'uuid', nullable: true })
  uploadedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
