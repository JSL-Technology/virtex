import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DocumentTemplateType } from '../entities/document-node.entity';

/**
 * The text fields of the multipart upload. FastifyFileInterceptor removes the file part and unwraps
 * every other field before validation, so these are ordinary values by the time this applies.
 */
export class UploadDocumentFieldsDto {
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsEnum(DocumentTemplateType)
  templateType?: DocumentTemplateType;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
