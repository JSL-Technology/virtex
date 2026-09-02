
import { Organization } from '../../organizations/entities/organization.entity';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';


export enum FixedAssetStatus {
  IN_USE = 'IN_USE',
  DISPOSED = 'DISPOSED',
  SOLD = 'SOLD',
}

@Entity()
export class FixedAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column()
  name: string;

  @Column()
  description: string;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformerNotNull })
  cost: number;

  @Column()
  purchaseDate: Date;

  @Column()
  usefulLife: number;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformerNotNull })
  residualValue: number;

  @Column()
  depreciationMethod: string;

  @Column('decimal', {
    name: 'book_value',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  bookValue: number;

  @Column('decimal', {
    name: 'accumulated_depreciation',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  accumulatedDepreciation: number;


  @Column({ type: 'enum', enum: FixedAssetStatus, default: FixedAssetStatus.IN_USE })
  status: FixedAssetStatus;

  @Column({ name: 'asset_account_id' })
  assetAccountId: string;

  @Column({ name: 'accumulated_depreciation_account_id' })
  accumulatedDepreciationAccountId: string;
}