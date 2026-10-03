import { JoinColumn, ManyToOne } from 'typeorm';
import { Organization } from '../entities/organization.entity';

/**
 * The tenant a row belongs to, as a constraint and not only a column.
 *
 * A tenant table whose `organization_id` nothing enforces survives its tenant: deleting the tenant
 * — offboarding, a privacy-erasure request — leaves the row behind, owned by nobody and visible to
 * no row-level-security policy, so it can never be found, exported or erased afterwards. Every
 * tenant table therefore declares the relation, and it always means the same thing:
 * `organization_id → organizations ON DELETE CASCADE`.
 *
 * One decorator instead of the relation spelled out in fifty entities, and published here — the
 * organizations module's public surface — so a domain declares that it is tenant-owned without
 * reaching into identity's entities. `tenant-deletion.spec.ts` fails for any table that does not.
 *
 *     @TenantOwned('FK_payslips_organization')
 *     organization?: TenantRef;
 */
export function TenantOwned(constraintName: string): PropertyDecorator {
  const relation = ManyToOne(() => Organization, { onDelete: 'CASCADE' });
  const join = JoinColumn({ name: 'organization_id', foreignKeyConstraintName: constraintName });
  return (target, propertyKey) => {
    join(target, propertyKey);
    relation(target, propertyKey);
  };
}

/** What a tenant-owned row can know about its tenant without importing identity's entity. */
export interface TenantRef {
  readonly id: string;
}
