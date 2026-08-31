
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';
import { NcfSequence } from './entities/ncf-sequence.entity';

import { VendorBill } from '../accounts-payable/entities/vendor-bill.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { AuthModule } from '../auth/auth.module';


@Module({

  imports: [TypeOrmModule.forFeature([NcfSequence, VendorBill, Invoice]), AuthModule],

  controllers: [ComplianceController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}