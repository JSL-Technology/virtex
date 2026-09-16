import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationSettings } from './entities/organization-settings.entity';
import { OrgSettingsService } from './services/org-settings.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OrganizationSettings])],
  providers: [OrgSettingsService],
  exports: [OrgSettingsService],
})
export class OrgSettingsModule {}
