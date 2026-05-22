import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { User } from '../users/entities/user.entity/user.entity';
import { MyWorkDto } from './dto/my-work.dto';
import { MyWorkService } from './my-work.service';

@ApiTags('My Work')
@Controller('my-work')
@UseGuards(JwtAuthGuard)
export class MyWorkController {
  constructor(private readonly myWorkService: MyWorkService) {}

  @Get()
  @ApiOkResponse({ type: MyWorkDto })
  getMyWork(@CurrentUser() user: User): Promise<MyWorkDto> {
    return this.myWorkService.getWorkItems(user.id, user.organizationId);
  }
}
