import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { SearchQueryDto } from './dto/search-query.dto';

@Controller('search')
@AuthenticatedOnly(
  'Global search over records the caller can already reach. There is no permission of its own:\n' +
  'each group of results is offered only to a principal holding the view permission of the module\n' +
  'that owns it (invoices:view, products:view, customers:view), checked in SearchService, and\n' +
  'invoices are narrowed to the branches the caller may see — the same answer each module gives.',
)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query() query: SearchQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.searchService.search(query.q, user, query.limit);
  }
}
