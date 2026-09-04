

import { Entity, PrimaryColumn, ManyToOne, JoinColumn, Column, Check } from 'typeorm';

import type { Organization } from './organization.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';

/**
 * Ownership outside 0–100 is not a percentage, and the value feeds the non-controlling interest
 * split directly: 150 % ownership produces a negative NCI, which reads as a real figure on a real
 * balance sheet. Nothing enforced the range.
 */
@Check('CHK_organization_subsidiaries_ownership', '"ownership" >= 0 AND "ownership" <= 100')
@Entity({ name: 'organization_subsidiaries' })
export class OrganizationSubsidiary {
  @PrimaryColumn({ name: 'parent_organization_id' })
  parentOrganizationId: string;

  @PrimaryColumn({ name: 'subsidiary_organization_id' })
  subsidiaryOrganizationId: string;

  @ManyToOne('Organization', 'subsidiaries', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_organization_id' })
  parent: Organization;

  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subsidiary_organization_id' })
  subsidiary: Organization;

  /**
   * Percentage of the subsidiary the parent owns, 0–100.
   *
   * The transformer is not cosmetic. A `decimal` column with no transformer is returned by the
   * driver as a **string**, and the only reader of this value interpolated it into a log line, so
   * nothing ever noticed. The moment it is used in arithmetic — which is what a non-controlling
   * interest is — `1 - "80"` is `-79`, and the consolidated equity split is nonsense.
   */
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    comment: 'Porcentaje de propiedad',
    transformer: numericTransformerNotNull,
  })
  ownership: number;

  /**
   * The date the parent obtained control.
   *
   * NIIF 10.20 consolidates from the date control is obtained, and NIC 21.39(b) translates the
   * subsidiary's pre-acquisition equity at the rate ruling on that date rather than at the closing
   * rate. Without it there is no way to separate pre- from post-acquisition reserves, and no way to
   * compute goodwill — the consolidation simply added the subsidiary's whole equity to the group's,
   * which credits the group with profits it earned before it owned the company.
   */
  @Column({ name: 'acquisition_date', type: 'date', nullable: true })
  acquisitionDate: string | null;

  /**
   * What the parent paid, in the parent's own currency. The consideration transferred, NIIF 3.32.
   */
  @Column({
    name: 'acquisition_cost',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  acquisitionCost: number | null;

  /**
   * The parent's account carrying the investment, which consolidation eliminates against the
   * subsidiary's equity. Nullable because a group may be structured without one.
   */
  @Column({ name: 'investment_account_id', type: 'uuid', nullable: true })
  investmentAccountId: string | null;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'investment_account_id',
    foreignKeyConstraintName: 'FK_organization_subsidiaries_investment_account',
  })
  investmentAccount: Account | null;
}
