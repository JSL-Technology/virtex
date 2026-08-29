import { PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Column } from 'typeorm';

/**
 * Columns shared by tenant-scoped entities.
 *
 * Deliberately NOT decorated with `@Entity()`. TypeORM treats an `@Entity()` class as a table
 * even when it is abstract, so the decorator that used to sit here produced a real, permanently
 * empty `base_entity` table in every generated schema — visible in the first baseline migration
 * as `CREATE TABLE "base_entity"`. Concrete subclasses carry their own `@Entity({ name })`;
 * TypeORM inherits the column metadata from an undecorated parent, which is exactly the
 * behaviour wanted here.
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string;
}
