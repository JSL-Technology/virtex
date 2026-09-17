import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './entities/employee.entity';
import { Department } from './entities/department.entity';
import { EmployeeCompensation } from './entities/employee-compensation.entity';
import { HcmService } from './hcm.service';
import { HcmController } from './hcm.controller';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
// The identity-document catalogue. HCM used to validate every country's employees with the
// Dominican algorithms because it had nowhere to ask what a country actually issues.
import { LocalizationProvisioningModule } from '../localization/localization-provisioning.module';
// Only the jurisdiction registry, as a leaf — not the whole payroll module.
import { JurisdictionsModule } from '../payroll/jurisdictions/jurisdictions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Employee, Department, EmployeeCompensation]),
    AuthModule,
    AuditModule,
    LocalizationProvisioningModule,
    JurisdictionsModule,
  ],
  controllers: [HcmController],
  providers: [HcmService],
  exports: [HcmService],
})
export class HcmModule {}
