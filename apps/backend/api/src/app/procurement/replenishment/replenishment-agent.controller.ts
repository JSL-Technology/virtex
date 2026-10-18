import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsPositive, IsUUID, ValidateIf } from 'class-validator';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { PERMISSIONS } from '../../shared/permissions';
import { CheckFeature } from '../../saas/contracts/entitlements.contract';
import { ReplenishmentAgentService } from './replenishment-agent.service';

export class ReplenishmentSettingsDto {
  @IsOptional()
  @IsBoolean({ message: 'validation.constraints.is_boolean' })
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true, message: 'validation.constraints.is_uuid' })
  warehouseIds?: string[];

  @IsOptional()
  @IsBoolean({ message: 'validation.constraints.is_boolean' })
  submitForApproval?: boolean;

  /** Null removes the limit. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.constraints.is_number' })
  @IsPositive({ message: 'validation.constraints.is_positive' })
  maxOrderAmount?: number | null;
}

/**
 * The replenishment agent's settings and a run on request. Managing an agent is the AI
 * administrator's; running it needs, in addition, the right to create purchase orders by hand.
 */
@ApiTags('Procurement')
@ApiBearerAuth()
@Controller('procurement/replenishment-agent')
@CheckFeature('ai_agents')
export class ReplenishmentAgentController {
  constructor(private readonly agent: ReplenishmentAgentService) {}

  @Get('settings')
  @HasPermission(PERMISSIONS.AI_AGENTS_MANAGE)
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.agent.settings(user.organizationId);
  }

  @Patch('settings')
  @HasPermission(PERMISSIONS.AI_AGENTS_MANAGE)
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReplenishmentSettingsDto) {
    return this.agent.updateSettings(user.organizationId, dto);
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.AI_AGENTS_MANAGE, PERMISSIONS.PROCUREMENT_MANAGE)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Draft purchase orders from the forecast now.' })
  run(@CurrentUser() user: AuthenticatedUser) {
    return this.agent.run(user.organizationId, user.id, 'MANUAL');
  }
}
