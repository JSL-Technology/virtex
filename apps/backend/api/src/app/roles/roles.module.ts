import { Module, forwardRef } from '@nestjs/common'; // [!code ++]
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { Role } from './entities/role.entity';
import { RolesLegacyOrganizationBackfillService } from './roles-legacy-organization-backfill.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Role]), 
    forwardRef(() => AuthModule) // [!code ++] // Usa forwardRef aquí
  ],
  controllers: [RolesController],
  providers: [RolesService, RolesLegacyOrganizationBackfillService],
  exports: [RolesService],
})
export class RolesModule {}