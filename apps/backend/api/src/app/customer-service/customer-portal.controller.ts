import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { CasesService } from './cases.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { InvoicesService } from '../invoices/invoices.service';

@Controller('customer-portal')
@UseGuards(JwtAuthGuard)
export class CustomerPortalController {
  constructor(
    private readonly casesService: CasesService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly invoicesService: InvoicesService,
  ) {}

  @Get('my-cases')
  getMyCases(@CurrentUser() user: User) {


    return this.casesService.findAll(user.organizationId);
  }

  @Get('my-invoices')
  getMyInvoices(@CurrentUser() user: User) {

    return this.invoicesService.findAll(user.organizationId);
  }

  @Get('knowledge-base')
  searchKnowledgeBase(@CurrentUser() user: User) {
    return this.knowledgeBaseService.findAllPublished(user.organizationId);
  }

  @Get('knowledge-base/:id')
  getKnowledgeBaseArticle(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.knowledgeBaseService.findOnePublished(id, user.organizationId);
  }
}