import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataTransferController } from './data-transfer.controller';
import { DataTransferService } from './data-transfer.service';
import { DataTransferRun } from './entities/data-transfer-run.entity';

/**
 * Export and import of the datasets the domains offer through `contracts/data-transfer`.
 * Depends on no domain: the registry is global (ContractsModule), filled by the domains.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DataTransferRun])],
  controllers: [DataTransferController],
  providers: [DataTransferService],
})
export class DataTransferModule {}
