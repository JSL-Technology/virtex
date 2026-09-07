import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { HasPermission } from '../../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../../shared/permissions';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { WithholdingRegimesService } from '../services/withholding-regimes.service';
import {
  CreateWithholdingRegimeDto,
  UpdateWithholdingRegimeDto,
} from '../dto/withholding-regime.dto';
import { coverageFor } from '../fiscal/fiscal-coverage';
import { OrganizationsService } from '../../organizations/organizations.service';
import { AuthenticatedOnly } from '../../auth/decorators/authenticated-only.decorator';

/**
 * The withholding regimes a tenant maintains, and what this product covers in their market.
 *
 * The two sit together because they answer the same question from opposite sides: the coverage
 * says what the product does for you here, and the regimes are what you supply when the answer is
 * "the rate depends on something only you know".
 */
@ApiTags('Localization — Withholding')
@ApiBearerAuth()
@Controller('localization')
@UseGuards(JwtAuthGuard)
export class WithholdingRegimesController {
  constructor(
    private readonly regimes: WithholdingRegimesService,
    private readonly organizations: OrganizationsService,
  ) {}

  /**
   * What this product does and does not do in the tenant's market.
   *
   * `marketStatus` alone was `available` or `preview`, and "preview" reads as "coming soon" rather
   * than "you can keep books here and you cannot issue a stamped document" — which is how a
   * Mexican tenant came to be shown the CFDI requirement, have their RFC validated, pay, and get a
   * fiscal adapter that returned nulls.
   */
  @Get('fiscal-coverage')
  @AuthenticatedOnly(
    'Which countries the product can issue and withhold in. A statement about Virtex, not about the\n' +
    'tenant, and the same answer for every caller.',
  )
  @ApiOperation({ summary: 'Qué cubre el producto en el mercado del contribuyente.' })
  async coverage(@CurrentUser() user: AuthenticatedUser) {
    const organization = await this.organizations.findOne(user.organizationId);
    return coverageFor(organization?.country ?? null);
  }

  @Get('withholding-regimes')
  @HasPermission(PERMISSIONS.TAXES_VIEW)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.regimes.list(user.organizationId);
  }

  @Post('withholding-regimes')
  @HasPermission(PERMISSIONS.TAXES_CREATE)
  create(@Body() dto: CreateWithholdingRegimeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.regimes.create(dto, user.organizationId);
  }

  @Patch('withholding-regimes/:id')
  @HasPermission(PERMISSIONS.TAXES_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWithholdingRegimeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.regimes.update(id, dto, user.organizationId);
  }

  @Delete('withholding-regimes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.TAXES_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.regimes.remove(id, user.organizationId);
  }
}
