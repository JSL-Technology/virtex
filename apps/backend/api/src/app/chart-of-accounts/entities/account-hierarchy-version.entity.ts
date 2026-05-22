import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Account } from "./account.entity";


@Entity({ name: 'account_hierarchy_versions' })
export class AccountHierarchyVersion {
    @PrimaryGeneratedColumn('uuid') id: string;
    @Column() accountId: string;
    @Column({ type: 'uuid', nullable: true }) parentId: string | null;
    @Column() effectiveDate: Date;
    @ManyToOne(() => Account, account => account.history)
    @JoinColumn({ name: 'accountId' })
    account: Account;
}