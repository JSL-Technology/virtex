import { IsUUID } from 'class-validator';

/** The supplier an approved requisition is ordered from. */
export class OrderFromRequisitionDto {
  @IsUUID()
  supplierId!: string;
}
