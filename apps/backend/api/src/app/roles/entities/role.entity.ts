
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

@Entity({ name: 'roles' })
export class Role {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ length: 100 })
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string;

    @Column('simple-array')
    permissions: string[];

    @Column({ name: 'is_system_role', default: false })
    isSystemRole: boolean;

    /**
     * The tenant this role belongs to; null for the platform-wide system roles.
     *
     * This column decides which permissions a member holds in which tenant — `PermissionsGuard`
     * resolves a principal's rights through it — and it carried NO foreign key. Two consequences,
     * both observed: a role could name an organization that does not exist, and deleting a tenant
     * left its roles behind forever. On the development database 52 of 56 rows in this table were
     * orphans of tenants that no longer existed. An authorization table is the last place that
     * should accumulate rows nobody can account for.
     */
    @Column({ name: 'organization_id', type: 'uuid', nullable: true })
    organizationId: string | null;

    @ManyToOne(() => Organization, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'organization_id' })
    organization?: Organization | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}