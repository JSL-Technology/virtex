
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { UsersService } from './users.service';

import { UsersController } from './users.controller';
import { MailModule } from '../mail/mail.module';
import { RolesModule } from '../roles/roles.module';
import { UserSubscriber } from './subscribers/user.subscriber';
import { UserCacheModule } from '../auth/modules/user-cache.module';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { PasswordService } from '../auth/services/password.service';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Organization]),
    RolesModule,
    MailModule,
    UserCacheModule,
    StorageModule,
    forwardRef(() => AuthModule),
    forwardRef(() => AuditModule),
    forwardRef(() => OrganizationsModule),
  ],

  controllers: [UsersController],
  providers: [UsersService, UserSubscriber, PasswordService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
