import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import type { HttpResponse as Response } from '../common/http/http.types';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CheckPlanLimit } from '../saas/decorators/plan-limit.decorator';
import { PlanLimitCheckGuard } from '../saas/guards/plan-limit-check.guard';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @UseGuards(PeriodLockGuard, PlanLimitCheckGuard)
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  @CheckPlanLimit(SaasResource.INVOICES, 1)
  create(
    @Body() createInvoiceDto: CreateInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.create(createInvoiceDto, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.findOne(id, user.organizationId);
  }

  @Post(':id/credit-note')
  @HttpCode(HttpStatus.CREATED)
  createCreditNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCreditNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.createCreditNote(
      { ...dto, invoiceId: id },
      user.organizationId,
    );
  }
  
  @Get(':id/pdf')
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.invoicesService.generateInvoicePdf(
      id,
      user.organizationId,
    );

    // `res.setHeader` is a Node/Express method and does not exist on a Fastify reply, so this
    // threw `res.setHeader is not a function` on every call — invoice PDF download was broken in
    // production. It compiled cleanly because the file typed its response as `express.Response`
    // while the application boots on `FastifyAdapter`. Fastify's own API is `header()`.
    res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="invoice-${id}.pdf"`)
      .header('Content-Length', String(pdfBuffer.length))
      .send(pdfBuffer);
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  registerPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('amount') amount: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.registerPayment(
      id,
      amount,
      user.organizationId,
    );
  }
}