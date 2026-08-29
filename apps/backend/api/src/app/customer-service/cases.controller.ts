import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { CasesService } from './cases.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('cases')
@UseGuards(JwtAuthGuard)
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.casesService.findAll(user.organizationId);
  }
}