
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './entities/employee.entity';
import { Department } from './entities/department.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Employee,
      Department
    ])
  ]
})
export class HcmModule {}
