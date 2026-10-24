import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { PERMISSIONS } from '../../shared/permissions';
import { ChangeAuditPort } from '../../contracts/audit/access-audit.contract';
import { AI_FEATURES, AiSettingsService } from './ai-settings.service';

export class UpdateAiSettingsDto {
  @IsOptional()
  @IsBoolean({ message: 'validation.constraints.is_boolean' })
  languageModels?: boolean;

  @IsOptional()
  @IsArray({ message: 'validation.constraints.is_array' })
  @ArrayMaxSize(AI_FEATURES.length)
  @IsIn(AI_FEATURES, { each: true, message: 'validation.constraints.is_in' })
  disabledFeatures?: string[];

  @IsOptional()
  @IsBoolean({ message: 'validation.constraints.is_boolean' })
  scheduledReports?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'validation.constraints.is_boolean' })
  imageEmbeddings?: boolean;

  /** Null returns the company to the platform default. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.constraints.is_number' })
  @Min(0, { message: 'validation.constraints.min' })
  monthlyBudgetUsd?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.constraints.is_number' })
  @Min(0, { message: 'validation.constraints.min' })
  dailyBudgetUsd?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'validation.constraints.is_int' })
  @Min(1, { message: 'validation.constraints.min' })
  @Max(3650, { message: 'validation.constraints.max' })
  conversationRetentionDays?: number;

  @IsOptional()
  @IsBoolean({ message: 'validation.constraints.is_boolean' })
  maskIdentifiers?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'validation.constraints.is_boolean' })
  activityMonitoring?: boolean;
}

/**
 * Administration › AI › Settings: what the company decides about its AI. Reading it is part of
 * reading the usage; changing it is its own permission, and every change lands in the audit trail
 * with its before and after.
 */
@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai/settings')
export class AiSettingsController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly audit: ChangeAuditPort,
  ) {}

  @Get()
  @HasPermission(PERMISSIONS.AI_USAGE_VIEW)
  @ApiOperation({ summary: "The company's AI settings in effect, the platform ceiling, and this month's spend." })
  async get(@CurrentUser() user: AuthenticatedUser) {
    const [settings, spend] = await Promise.all([this.settings.get(user.organizationId), this.settings.spend(user.organizationId)]);
    return { settings, spend, features: AI_FEATURES };
  }

  @Put()
  @HasPermission(PERMISSIONS.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: "Change the company's AI settings. Audited." })
  async update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAiSettingsDto) {
    const before = await this.settings.get(user.organizationId);
    const after = await this.settings.update(user.organizationId, user.id, dto);
    await this.audit.recordChange({
      userId: user.id,
      organizationId: user.organizationId,
      entity: 'ai_organization_settings',
      entityId: user.organizationId,
      before,
      after,
    });
    return { settings: after, spend: await this.settings.spend(user.organizationId), features: AI_FEATURES };
  }
}
