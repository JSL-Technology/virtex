import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Somebody who asked to be told when the product opens in their country (QA A-13).
 *
 * One row per address and country: asking twice is the same request, and refreshes `updatedAt`
 * and the language to write back in.
 */
@Entity({ name: 'market_waitlist' })
@Index('UQ_market_waitlist_email_country', ['email', 'countryCode'], { unique: true })
export class MarketWaitlistEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 254 })
  email: string;

  @Column({ name: 'country_code', type: 'varchar', length: 2 })
  countryCode: string;

  @Column({ type: 'varchar', length: 5, nullable: true })
  language: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
