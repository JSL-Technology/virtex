import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
  providers: [SuppliersService],
})
export class SuppliersModule {}