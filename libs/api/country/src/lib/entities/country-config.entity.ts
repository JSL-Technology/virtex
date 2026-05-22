import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('country_configs')
export class CountryConfig {
  @PrimaryColumn({ length: 2 })
  code: string; // 'DO', 'US'

  @Column()
  name: string; // 'Dominican Republic'

  @Column()
  currencyCode: string; // 'DOP'

  @Column()
  currencySymbol: string; // 'RD$'

  @Column()
  locale: string; // 'es-DO'

  @Column()
  phoneCode: string; // '+1'

  @Column('jsonb')
  formSchema: any; // The JSON Schema for registration
}
