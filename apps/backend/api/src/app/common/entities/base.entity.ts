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

  /**
   * The tenant this row belongs to. Never null.
   *
   * It used to be `nullable: true`, and sixteen of the twenty-four tables built from this class
   * carried the column as nullable in the database to match. A tenant-scoped row with no tenant is
   * not a row with a missing field: it is a row no row-level-security policy can see
   * (`organization_id = current_setting(...)` is never true of NULL), that no tenant owns, and
   * that no tenant's deletion cascades away. The seven payroll and HCM tables that got it right
   * did so by re-declaring the column in the subclass — which TypeORM does not honour, so the
   * override was inert and `check:schema-drift` proposed dropping the NOT NULL from all seven on
   * every run.
   *
   * One declaration, NOT NULL, and `1789005000000-TenantColumnNotNull.ts` brings the sixteen
   * laggards up to it.
   */
  @Column({ name: 'organization_id', type: 'uuid', nullable: false })
  organizationId: string;
}
