import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** The text fields beside the .p12 file. */
export class UploadCertificateFieldsDto {
  @IsString()
  @IsNotEmpty({ message: 'einvoicing.certificate.password_required' })
  @MaxLength(1024)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string;
}
