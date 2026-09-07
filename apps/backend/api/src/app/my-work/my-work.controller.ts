import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { User } from '../users/entities/user.entity/user.entity';
import { MyWorkDto } from './dto/my-work.dto';
import { MyWorkService } from './my-work.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AuthenticatedOnly } from '../auth/decorators/authenticated-only.decorator';

@ApiTags('My Work')
@Controller('my-work')
@UseGuards(JwtAuthGuard)
@AuthenticatedOnly(
  'The caller\'s own work queue. It aggregates documents the user can already see — the underlying\n' +
  'queries carry the same permissions applied everywhere else — so a permission on the aggregate\n' +
  'would either duplicate those or contradict them.',
)
export class MyWorkController {
  constructor(private readonly myWorkService: MyWorkService) {}

  @Get()
  @ApiOkResponse({ type: MyWorkDto })
  getMyWork(@CurrentUser() user: AuthenticatedUser): Promise<MyWorkDto> {
    return this.myWorkService.getWorkItems(user.id, user.organizationId);
  }
}
