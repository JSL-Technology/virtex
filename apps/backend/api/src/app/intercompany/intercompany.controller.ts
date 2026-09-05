import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IntercompanyService } from './intercompany.service';
import { CreateIntercompanyTransactionDto } from './dto/create-intercompany-transaction.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';

/**
 * Intercompany movements.
 *
 * The single route here used to carry `JwtAuthGuard` and nothing else — no permission, and no check
 * that the tenant named in the body had anything to do with the caller's. Combined with a body that
 * supplied both the destination organization and the destination account, that is a write primitive
 * into any tenant in the database. It was only ever theoretical because the module was registered
 * nowhere; registering it without fixing this would have made it real.
 */
@ApiTags('Intercompany')
@ApiBearerAuth()
@Controller('intercompany')
@UseGuards(JwtAuthGuard)
export class IntercompanyController {
  constructor(private readonly intercompanyService: IntercompanyService) {}

  @Post('transactions')
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.INTERCOMPANY_TRANSACT)
  @ApiOperation({
    summary:
      'Registra un movimiento entre dos compañías del mismo grupo y contabiliza ambos lados.',
  })
  createTransaction(
    @Body() dto: CreateIntercompanyTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.intercompanyService.create(dto, user.organizationId, user.id);
  }

  @Get('transactions')
  @HasPermission(PERMISSIONS.INTERCOMPANY_VIEW)
  @ApiOperation({ summary: 'Lista los movimientos intercompañía de la organización.' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.intercompanyService.findAll(user.organizationId);
  }

  /**
   * Movements whose other half has not landed.
   *
   * Anything on this list is a group that does not balance right now. There was no equivalent: a
   * destination entry that never posted was invisible.
   */
  @Get('transactions/pending')
  @HasPermission(PERMISSIONS.INTERCOMPANY_VIEW)
  @ApiOperation({ summary: 'Movimientos intercompañía cuyo asiento de destino no se ha creado.' })
  findPending(@CurrentUser() user: AuthenticatedUser) {
    return this.intercompanyService.findPending(user.organizationId);
  }

  @Post('transactions/:id/retry')
  @HasPermission(PERMISSIONS.INTERCOMPANY_TRANSACT)
  @ApiOperation({ summary: 'Reintenta el asiento de destino de un movimiento fallido.' })
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.intercompanyService.retry(id, user.organizationId);
  }
}
