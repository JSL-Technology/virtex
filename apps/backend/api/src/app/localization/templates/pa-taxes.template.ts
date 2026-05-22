
import { TaxType } from "../../taxes/entities/tax.entity";



export const panamaTaxTemplate = {
  countryCode: 'PA',
  taxes: [
    {
      name: 'ITBMS - 7%',
      rate: 7.00,
      type: TaxType.PERCENTAGE,
      countryCode: 'PA',
    }
  ],
};