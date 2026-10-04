import { Body, Controller, Get, Param, ParseEnumPipe, Patch } from '@nestjs/common';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { PERMISSIONS } from '../permissions';
import { DocumentSequencesService } from './document-sequences.service';
import { DocumentType } from './entities/document-sequence.entity';

export class UpdateDocumentSequenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'validation.constraints.max_length|{"max":20}' })
  prefix?: string;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  nextNumber?: number;
}

/** The internal numbering of each document type (QA M-09: «Secuencias» said «En desarrollo»). */
@Controller('document-sequences')
export class DocumentSequencesController {
  constructor(private readonly sequences: DocumentSequencesService) {}

  @Get()
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.sequences.list(user.organizationId);
  }

  @Patch(':type')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  update(
    @Param('type', new ParseEnumPipe(DocumentType)) type: DocumentType,
    @Body() dto: UpdateDocumentSequenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sequences.update(user.organizationId, type, dto);
  }
}
