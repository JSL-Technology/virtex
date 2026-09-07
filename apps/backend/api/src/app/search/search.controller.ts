import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AuthenticatedOnly } from '../auth/decorators/authenticated-only.decorator';

@UseGuards(JwtAuthGuard)
@Controller('search')
@AuthenticatedOnly(
  'Global search over records the caller can already reach. Results are produced by the same\n' +
  'services, and therefore the same authorisation, that guard each module; a permission here would\n' +
  'gate the index rather than the data, which is the wrong place to say no.',
)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query('q') query: string, @CurrentUser() user: AuthenticatedUser) {
    return this.searchService.search(query, user.organizationId);
  }
}