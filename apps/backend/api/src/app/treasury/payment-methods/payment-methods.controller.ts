import { RequireStepUp, StepUpScope } from '../../auth/contracts/step-up.contract';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../../shared/permissions';
import { PaymentMethodsService } from './payment-methods.service';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from '../dto/payment-method.dto';

/**
 * The company's payment methods: read by every form that records how a document is paid, edited
 * from Treasury › Payment methods where the market lets the company shape them.
 *
 * Reading is `treasury:view`, like the bank catalogue beside it; writing is the grant that manages
 * the bank catalogue and accounts, because it is the same kind of master data.
 */
@ApiTags('Treasury — Payment methods')
@ApiBearerAuth()
@Controller('treasury/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @Get()
  @HasPermission(PERMISSIONS.TREASURY_VIEW)
  @ApiOperation({ summary: 'Formas de pago de la empresa (incluye las retiradas salvo activeOnly=true).' })
  findAll(@CurrentUser() user: AuthenticatedUser, @Query('activeOnly') activeOnly?: string) {
    return this.methods.findAll(user.organizationId, activeOnly !== 'true');
  }

  @Post()
  @HasPermission(PERMISSIONS.TREASURY_MANAGE_ACCOUNTS)
  // Which payment kind a method maps to decides the e-CF's «FormaPago» and the 607's columns.
  @RequireStepUp(StepUpScope.MANAGE_BANK_ACCOUNTS)
  create(@Body() dto: CreatePaymentMethodDto, @CurrentUser() user: AuthenticatedUser) {
    return this.methods.create(dto, user.organizationId);
  }

  /** Rename, re-map, reorder, retire or reinstate. Never delete: documents keep the code. */
  @Patch(':id')
  @HasPermission(PERMISSIONS.TREASURY_MANAGE_ACCOUNTS)
  @RequireStepUp(StepUpScope.MANAGE_BANK_ACCOUNTS)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdatePaymentMethodDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.methods.update(id, dto, user.organizationId);
  }
}
