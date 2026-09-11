import { PartialType } from '@nestjs/mapped-types';
import { CreateBinLocationDto } from './create-bin-location.dto';

export class UpdateBinLocationDto extends PartialType(CreateBinLocationDto) {}
