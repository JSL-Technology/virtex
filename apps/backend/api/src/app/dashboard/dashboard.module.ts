
import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AuthModule } from '../auth/auth.module';
import { CacheModule } from '@nestjs/cache-manager';

import { FinancialReportingModule } from '../financial-reporting/financial-reporting.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from '../organizations/entities/organization.entity';

@Module({
  imports: [
    CacheModule.register(),
    AuthModule,
    ChartOfAccountsModule,
    InventoryModule,
    FinancialReportingModule,
    TypeOrmModule.forFeature([Organization]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}