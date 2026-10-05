import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { StatementQueryDto } from '../shared/statements/statement-query.dto';
import { SupplierStatementService } from './supplier-statement.service';

/** The statement of account (audit H-17): the partner ledger, from the subledger documents. */
@ApiTags('Statements')
@ApiBearerAuth()
@Controller('suppliers')
export class SupplierStatementsController {
  constructor(private readonly statements: SupplierStatementService) {}

  @Get(':id/statement')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  @ApiOperation({ summary: 'Estado de cuenta del proveedor: facturas, pagos, notas y saldo corrido.' })
  statement(
    @Param('id', UuidParamPipe) id: string,
    @Query() query: StatementQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.statements.statement(user.organizationId, id, query, user.id);
  }
}
