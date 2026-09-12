import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './entities/employee.entity';
import { Department } from './entities/department.entity';
import { EmployeeCompensation } from './entities/employee-compensation.entity';
import { HcmService } from './hcm.service';
import { HcmController } from './hcm.controller';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Employee, Department, EmployeeCompensation]),
    AuthModule,
    AuditModule,
  ],
  controllers: [HcmController],
  providers: [HcmService],
  exports: [HcmService],
})
export class HcmModule {}
