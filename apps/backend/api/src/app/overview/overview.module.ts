import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { User } from '../users/entities/user.entity/user.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { VendorBill } from '../accounts-payable/entities/vendor-bill.entity';
import { AccountingPeriod } from '../accounting/entities/accounting-period.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, User, Invoice, VendorBill, AccountingPeriod]),
    AuthModule,
  ],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
