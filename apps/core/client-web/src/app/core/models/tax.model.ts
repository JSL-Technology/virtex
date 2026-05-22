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