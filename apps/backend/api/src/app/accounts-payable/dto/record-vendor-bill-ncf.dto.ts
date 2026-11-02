import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The supplier's comprobante, recorded on a bill posted without one (QA R3-A04). */
export class RecordVendorBillNcfDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(19)
  ncf!: string;
}
