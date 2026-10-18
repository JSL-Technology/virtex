import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthenticatedOnly } from '../../security/decorators/authenticated-only.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ForbiddenError } from '../../i18n/localized.exception';
import type { DuplicateEntityType } from '../../contracts/data-quality/duplicate-sources.contract';
import type { DuplicateStatus } from '../entities/ai-duplicate-suggestion.entity';
import { DataQualityService } from './data-quality.service';

export class DuplicateListQueryDto {
  @IsOptional()
  @IsIn(['CUSTOMER', 'SUPPLIER', 'PRODUCT'], { message: 'validation.constraints.is_in' })
  type?: DuplicateEntityType;

  @IsOptional()
  @IsIn(['OPEN', 'SAME', 'NOT_DUPLICATE', 'STALE'], { message: 'validation.constraints.is_in' })
  status?: DuplicateStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'validation.constraints.is_int' })
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(200, { message: 'validation.constraints.max|{"max":200}' })
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'validation.constraints.is_int' })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  offset?: number;
}

export class DuplicateDecisionDto {
  @IsIn(['SAME', 'NOT_DUPLICATE', 'OPEN'], { message: 'validation.constraints.is_in' })
  decision: 'SAME' | 'NOT_DUPLICATE' | 'OPEN';
}

/**
 * Master data › Data quality: probable duplicate customers, suppliers and products.
 *
 * One route for three record types, each guarded by its own permission: a person sees the types
 * they may read and decides on the types they may edit — checked in the service, per record type,
 * which a single route-level permission could not express.
 */
@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai/data-quality')
@AuthenticatedOnly('Filtered per record type by that type’s own view and edit permissions, in DataQualityService.')
export class DataQualityController {
  constructor(private readonly quality: DataQualityService) {}

  @Get('duplicates')
  @ApiOperation({ summary: 'Probable duplicates of the record types this person may read.' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: DuplicateListQueryDto) {
    return this.quality.list(user.organizationId, user, query);
  }

  @Post('duplicates/scan')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @ApiOperation({ summary: 'Look for duplicates again now (also done every week).' })
  async scan(@CurrentUser() user: AuthenticatedUser) {
    if (!this.quality.visibleTypes(user).length) throw new ForbiddenError('ai.data_quality.cannot_view');
    return this.quality.scan(user.organizationId);
  }

  @Post('duplicates/:id/decision')
  @HttpCode(HttpStatus.OK)
  decide(@Param('id', UuidParamPipe) id: string, @Body() dto: DuplicateDecisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.quality.decide(user.organizationId, user, id, dto.decision);
  }
}
