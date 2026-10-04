import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateEmployeeDto } from './create-employee.dto';

/** A raise is a new compensation row (`POST employees/:id/compensation`), never an edit. */
export class UpdateEmployeeDto extends PartialType(OmitType(CreateEmployeeDto, ['initialCompensation'] as const)) {}
