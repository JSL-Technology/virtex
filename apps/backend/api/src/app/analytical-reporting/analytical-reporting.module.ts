
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticalReportingService } from './analytical-reporting.service';
import { AnalyticalReportingController } from './analytical-reporting.controller';
import { AnalyticalReportData } from './entities/analytical-report-data.entity';
import { AuthModule } from '../auth/auth.module';
import { AnalyticalReportingCron } from './analytical-reporting.cron';

@Module({
  imports: [TypeOrmModule.forFeature([AnalyticalReportData]), AuthModule],
  controllers: [AnalyticalReportingController],
  providers: [AnalyticalReportingService, AnalyticalReportingCron],
})
export class AnalyticalReportingModule {}