import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesService } from './roles.service';
import { RoleDelegationPort } from '../auth/ports/role-delegation.port';
import { RolesController } from './roles.controller';
import { Role } from './entities/role.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Role]),
    // `AuthModule` imports `RolesModule` back (for `RoleDelegationPort`), so this side needs
    // `forwardRef` too to break the circular reference.
    forwardRef(() => AuthModule),
  ],
  controllers: [RolesController],
  providers: [RolesService, { provide: RoleDelegationPort, useExisting: RolesService }],
  exports: [RolesService, RoleDelegationPort],
})
export class RolesModule {}