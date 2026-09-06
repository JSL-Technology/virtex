
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditTrailService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditAccessInterceptor } from './audit-access.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
  ],
  providers: [AuditTrailService, AuditAccessInterceptor],
  controllers: [AuditController],
  // The interceptor is exported so the modules whose reports and exports are audited can apply it
  // with `@UseInterceptors` without each declaring its own copy — one instance, one audit service.
  exports: [AuditTrailService, AuditAccessInterceptor],
})
export class AuditModule {}