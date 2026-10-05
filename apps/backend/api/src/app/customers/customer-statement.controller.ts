import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { StatementQueryDto } from '../shared/statements/statement-query.dto';
import { CustomerStatementService } from './customer-statement.service';

/** The statement of account (audit H-17): the partner ledger, from the subledger documents. */
@ApiTags('Statements')
@ApiBearerAuth()
@Controller('customers')
export class CustomerStatementsController {
  constructor(private readonly statements: CustomerStatementService) {}

  @Get(':id/statement')
  @HasPermission(PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW)
  @ApiOperation({ summary: 'Estado de cuenta del cliente: documentos, cobros y saldo corrido.' })
  statement(
    @Param('id', UuidParamPipe) id: string,
    @Query() query: StatementQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.statements.statement(user.organizationId, id, query, user.id);
  }
}
