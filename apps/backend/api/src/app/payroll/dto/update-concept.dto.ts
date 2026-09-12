import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateConceptDto } from './create-concept.dto';

/** Everything on a concept is editable except its `code`, which is the stable reference. */
export class UpdateConceptDto extends PartialType(OmitType(CreateConceptDto, ['code'] as const)) {}
