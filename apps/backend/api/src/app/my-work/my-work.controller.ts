import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { MyWorkDto } from './dto/my-work.dto';
import { MyWorkService } from './my-work.service';
import { AuthenticatedUser } from '../security/principal';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';

@ApiTags('My Work')
@Controller('my-work')
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
