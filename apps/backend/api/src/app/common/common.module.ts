
import { Module } from '@nestjs/common';
import { CommonController } from './controllers/common.controller';
import { ConfigController } from './controllers/config.controller';
import { UsersModule } from '../users/users.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LocalizationModule } from '../localization/localization.module';

@Module({
    imports: [UsersModule, OrganizationsModule, LocalizationModule],
    controllers: [CommonController, ConfigController],
    providers: [],
})
export class CommonModule {}
