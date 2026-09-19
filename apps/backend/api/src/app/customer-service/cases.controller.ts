import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { CasesService } from './cases.service';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('cases')
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  @HasPermission(PERMISSIONS.CASES_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.casesService.findAll(user.organizationId);
  }
}