import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { CasesService } from './cases.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { InvoicesService } from '../invoices/invoices.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('customer-portal')
@UseGuards(JwtAuthGuard)
export class CustomerPortalController {
  constructor(
    private readonly casesService: CasesService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly invoicesService: InvoicesService,
  ) {}

  @Get('my-cases')
  @HasPermission(PERMISSIONS.CUSTOMER_PORTAL_ACCESS)
  getMyCases(@CurrentUser() user: AuthenticatedUser) {


    return this.casesService.findAll(user.organizationId);
  }

  @Get('my-invoices')
  @HasPermission(PERMISSIONS.CUSTOMER_PORTAL_ACCESS)
  getMyInvoices(@CurrentUser() user: AuthenticatedUser) {

    return this.invoicesService.findAll(user.organizationId);
  }

  @Get('knowledge-base')
  @HasPermission(PERMISSIONS.CUSTOMER_PORTAL_ACCESS)
  searchKnowledgeBase(@CurrentUser() user: AuthenticatedUser) {
    return this.knowledgeBaseService.findAllPublished(user.organizationId);
  }

  @Get('knowledge-base/:id')
  @HasPermission(PERMISSIONS.CUSTOMER_PORTAL_ACCESS)
  getKnowledgeBaseArticle(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.knowledgeBaseService.findOnePublished(id, user.organizationId);
  }
}