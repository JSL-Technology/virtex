import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * The supplier's fiscal document number, recorded on a bill posted without one (QA R3-A04) — in
 * whatever market the company is in, where its authority numbers such a document.
 */
export class RecordSupplierFiscalNumberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  supplierFiscalNumber!: string;
}
