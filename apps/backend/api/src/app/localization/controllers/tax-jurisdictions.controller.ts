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
import { TaxJurisdictionsService } from '../services/tax-jurisdictions.service';
import {
  CreateTaxJurisdictionDto,
  UpdateTaxJurisdictionDto,
} from '../dto/tax-jurisdiction.dto';

/**
 * Where the tenant is registered to collect sales tax, and at what rate.
 *
 * These rows are what makes a United States or Brazilian document priceable. Without them the rate
 * came off the request with nothing checking it — no jurisdiction determination, no destination
 * sourcing, no record of nexus. A tenant with nexus in three states maintains a handful of rows
 * here; one whose footprint outgrows that connects a determination provider instead.
 */
@ApiTags('Localization — Tax jurisdictions')
@ApiBearerAuth()
@Controller('localization/tax-jurisdictions')
@UseGuards(JwtAuthGuard)
export class TaxJurisdictionsController {
  constructor(private readonly jurisdictions: TaxJurisdictionsService) {}

  @Get()
  @HasPermission(PERMISSIONS.TAXES_VIEW)
  @ApiOperation({ summary: 'Jurisdicciones en las que el contribuyente está registrado.' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.jurisdictions.list(user.organizationId);
  }

  @Post()
  @HasPermission(PERMISSIONS.TAXES_CREATE)
  create(@Body() dto: CreateTaxJurisdictionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.jurisdictions.create(dto, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.TAXES_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaxJurisdictionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jurisdictions.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.TAXES_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.jurisdictions.remove(id, user.organizationId);
  }
}
