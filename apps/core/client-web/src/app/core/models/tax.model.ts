export enum TaxType {
  PERCENTAGE = 'Porcentaje',
  FIXED = 'Fijo',
}

export interface Tax {
  id: string;
  name: string;
  rate: number;
  type: TaxType;
  countryCode?: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}
/**
 * The catalogue key for a tax type. The stored values are Spanish words (`'Porcentaje'`, `'Fijo'`)
 * and were shown as such in every language (QA M-17).
 */
export function taxTypeLabel(type: TaxType | string | null | undefined): string {
  switch (type) {
    case TaxType.PERCENTAGE:
      return 'masters.taxes.type_percentage';
    case TaxType.FIXED:
      return 'masters.taxes.type_fixed';
    default:
      return type ?? '';
  }
}
