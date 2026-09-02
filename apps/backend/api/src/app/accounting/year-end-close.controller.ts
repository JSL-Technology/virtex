
import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { YearEndCloseService } from './year-end-close.service';
import { YearEndCloseDto } from './dto/year-end-close.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('accounting/year-end-close')
@UseGuards(JwtAuthGuard)
export class YearEndCloseController {
  constructor(private readonly yearEndCloseService: YearEndCloseService) {}

  @HasPermission(PERMISSIONS.ACCOUNTING_CLOSE_YEAR)
  @Post()
  @HttpCode(HttpStatus.OK)
  async closePeriod(
    @Body() closeDto: YearEndCloseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const closedYear = await this.yearEndCloseService.closeFiscalYear(
      closeDto,
      user.organizationId,
      user.id,
    );
    return {
      message: `El año fiscal que termina en ${closedYear.endDate.toISOString().split('T')[0]} ha sido cerrado exitosamente.`,
      fiscalYear: closedYear,
    };
  }
}