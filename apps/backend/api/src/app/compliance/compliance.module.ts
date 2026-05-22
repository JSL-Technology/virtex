
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceService } from './compliance.service';
import { NcfSequence } from './entities/ncf-sequence.entity';

import { VendorBill } from '../accounts-payable/entities/vendor-bill.entity';
import { Invoice } from '../invoices/entities/invoice.entity';


@Module({

  imports: [TypeOrmModule.forFeature([NcfSequence, VendorBill, Invoice])],

  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}