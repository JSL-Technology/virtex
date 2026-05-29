
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditTrailService } from './audit.service';
import { AuditController } from './audit.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
  ],
  providers: [AuditTrailService],
  controllers: [AuditController],
  exports: [AuditTrailService],
})
export class AuditModule {}