import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalRequest } from '../workflows/entities/approval-request.entity';
import { MyWorkController } from './my-work.controller';
import { MyWorkService } from './my-work.service';
import { ModuleInboxController } from './module-inbox.controller';
import { ModuleInboxService } from './module-inbox.service';

@Module({
  imports: [TypeOrmModule.forFeature([ApprovalRequest])],
  controllers: [MyWorkController, ModuleInboxController],
  providers: [MyWorkService, ModuleInboxService],
})
export class MyWorkModule {}
