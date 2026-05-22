import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationSettings } from './entities/organization-settings.entity';
import { OrganizationSubsidiary } from './entities/organization-subsidiary.entity';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      OrganizationSettings,
      OrganizationSubsidiary
    ]),
    ChartOfAccountsModule,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService]
})
export class OrganizationsModule {}
