import { PartialType } from '@nestjs/mapped-types';
import { CreateVendorDebitNoteDto } from './create-vendor-debit-note.dto';

export class UpdateVendorDebitNoteDto extends PartialType(
  CreateVendorDebitNoteDto,
) {}