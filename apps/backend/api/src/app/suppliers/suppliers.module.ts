import { SuppliersDuplicatesSource } from './suppliers-duplicates.source';
import { SuppliersCopilotTools } from './suppliers.copilot-tools';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SuppliersDataTransferProvider } from './suppliers-data-transfer.provider';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { Supplier } from './entities/supplier.entity';
import { AuthModule } from '../auth/auth.module';
// The identity-document catalogue: suppliers' tax ids were stored with no type and no validation.
import { LocalizationProvisioningModule } from '../localization/localization-provisioning.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Supplier]),
    AuthModule,
    LocalizationProvisioningModule,
  ],
  controllers: [SuppliersController],
  providers: [SuppliersDuplicatesSource, SuppliersCopilotTools, SuppliersService, SuppliersDataTransferProvider],
  exports: [SuppliersService],
})
export class SuppliersModule {}