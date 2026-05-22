import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalRequest } from '../workflows/entities/approval-request.entity';
import { MyWorkController } from './my-work.controller';
import { MyWorkService } from './my-work.service';

@Module({
  imports: [TypeOrmModule.forFeature([ApprovalRequest])],
  controllers: [MyWorkController],
  providers: [MyWorkService],
})
export class MyWorkModule {}
