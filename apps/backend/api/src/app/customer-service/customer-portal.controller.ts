import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { CasesService } from './cases.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { InvoicesService } from '../invoices/invoices.service';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CustomerPortalAccountsService } from './customer-portal-accounts.service';
import { RequireStepUp, StepUpScope } from '../auth/contracts/step-up.contract';
import { PortalListQueryDto } from './dto/portal-list-query.dto';

class GrantPortalAccountDto {
  @IsUUID()
  userId!: string;

  @IsUUID()
  customerId!: string;
}

/**
 * The customer's own view of their documents (CS-01).
 *
 * "my-cases" and "my-invoices" used to answer with every case and invoice of the tenant to anyone
 * holding `customer_portal:access`: there was no notion of which customer the caller was. They now
 * answer for the one customer the caller's portal account binds them to, and refuse a caller with
 * none — so granting the permission to an outsider no longer opens the whole customer book.
 */
@Controller('customer-portal')
export class CustomerPortalController {
  constructor(
    private readonly casesService: CasesService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly invoicesService: InvoicesService,
    private readonly accounts: CustomerPortalAccountsService,
  ) {}

  @Get('my-cases')
  @HasPermission(PERMISSIONS.CUSTOMER_PORTAL_ACCESS)
  async getMyCases(@CurrentUser() user: AuthenticatedUser) {
    const customerId = await this.accounts.requireCustomer(user.organizationId, user.id);
    return this.casesService.findAll(user.organizationId, { customerId });
  }

  @Get('my-invoices')
  @HasPermission(PERMISSIONS.CUSTOMER_PORTAL_ACCESS)
  async getMyInvoices(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalListQueryDto) {
    const customerId = await this.accounts.requireCustomer(user.organizationId, user.id);
    // Issued documents only: a draft is the company's work in progress, not the customer's bill.
    return this.invoicesService.findAll(user.organizationId, {
      customerId,
      excludeDrafts: true,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('knowledge-base')
  @HasPermission(PERMISSIONS.CUSTOMER_PORTAL_ACCESS)
  searchKnowledgeBase(@CurrentUser() user: AuthenticatedUser) {
    return this.knowledgeBaseService.findAllPublished(user.organizationId);
  }

  @Get('knowledge-base/:id')
  @HasPermission(PERMISSIONS.CUSTOMER_PORTAL_ACCESS)
  getKnowledgeBaseArticle(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.knowledgeBaseService.findOnePublished(id, user.organizationId);
  }

  // ── Who is which customer: managed by the company ─────────────────────────

  @Get('accounts')
  @HasPermission(PERMISSIONS.CUSTOMERS_VIEW)
  listAccounts(@CurrentUser() user: AuthenticatedUser, @Query('customerId', new ParseUUIDPipe({ optional: true })) customerId?: string) {
    return this.accounts.list(user.organizationId, customerId);
  }

  /** Giving someone outside the company a view of a customer's documents rewrites who reads what. */
  @Post('accounts')
  @HasPermission(PERMISSIONS.CUSTOMERS_EDIT)
  @RequireStepUp(StepUpScope.MANAGE_ROLES)
  grantAccount(@Body() dto: GrantPortalAccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.grant(user.organizationId, dto, user.id);
  }

  @Delete('accounts/:id')
  @HasPermission(PERMISSIONS.CUSTOMERS_EDIT)
  revokeAccount(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.revoke(user.organizationId, id, user.id);
  }
}
