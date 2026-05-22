import { PartialType } from '@nestjs/mapped-types';
import { CreateVendorBillDto } from './create-vendor-bill.dto';

export class UpdateVendorBillDto extends PartialType(CreateVendorBillDto) {}