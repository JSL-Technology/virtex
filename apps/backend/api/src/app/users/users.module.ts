
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

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Organization]),
    RolesModule,
    MailModule,
    UserCacheModule,
    StorageModule,
  ],

  controllers: [UsersController],
  providers: [UsersService, UserSubscriber],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
