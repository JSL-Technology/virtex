import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { FlowDocumentType } from '../contracts/document-flow.contracts';
import { FLOW_LIMITS } from '../document-flow.service';

/** `GET /relationship-map/:type/:id` — how far and how wide to walk. Both are clamped server-side too. */
export class RelationshipMapQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(FLOW_LIMITS.maxDepth, { message: `validation.constraints.max|{"max":${FLOW_LIMITS.maxDepth}}` })
  @IsOptional()
  depth?: number;

  @Type(() => Number)
  @IsInt()
  @Min(2, { message: 'validation.constraints.min|{"min":2}' })
  @Max(FLOW_LIMITS.maxNodes, { message: `validation.constraints.max|{"max":${FLOW_LIMITS.maxNodes}}` })
  @IsOptional()
  limit?: number;
}

/** `GET /relationship-map/search` — a document number (or id) to open a map from. */
export class RelationshipMapSearchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80, { message: 'validation.constraints.max_length|{"max":80}' })
  q!: string;

  @IsEnum(FlowDocumentType)
  @IsOptional()
  type?: FlowDocumentType;
}
