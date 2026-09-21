import { Module, forwardRef } from '@nestjs/common'; // [!code ++]
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesService } from './roles.service';
import { RoleDelegationPort } from '../auth/ports/role-delegation.port';
import { RolesController } from './roles.controller';
import { Role } from './entities/role.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Role]), 
    forwardRef(() => AuthModule) // [!code ++] // Usa forwardRef aquí
  ],
  controllers: [RolesController],
  providers: [RolesService, { provide: RoleDelegationPort, useExisting: RolesService }],
  exports: [RolesService, RoleDelegationPort],
})
export class RolesModule {}