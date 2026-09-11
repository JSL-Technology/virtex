import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './entities/employee.entity';
import { Department } from './entities/department.entity';
import { HcmService } from './hcm.service';
import { HcmController } from './hcm.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Employee, Department]), AuthModule],
  controllers: [HcmController],
  providers: [HcmService],
  exports: [HcmService],
})
export class HcmModule {}
