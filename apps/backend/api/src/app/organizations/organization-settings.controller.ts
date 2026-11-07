import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { OrganizationSettingsSectionsService } from './services/organization-settings-sections.service';

export class UpdateSettingsSectionDto {
  /** Default accounts by field name; `null` clears one. Checked against the section's own list. */
  @IsOptional()
  @IsObject()
  accounts?: Record<string, string | null>;

  /** Policy values by field name, each validated by the section's rule. */
  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  baseCurrency?: string;
}

/**
 * The organization's settings, by section (QA M-09): accounting, currencies, taxes, closing,
 * intercompany, inventory. Reading them is part of editing the company; so is changing them.
 */
@Controller('organizations/settings')
export class OrganizationSettingsController {
  constructor(private readonly sections: OrganizationSettingsSectionsService) {}

  /**
   * One read per section, and the settings pages read several at once: «Cuentas predeterminadas»
   * opens six sections, «Políticas contables» five, «Comprobantes fiscales» two. Under the default
   * 20 per minute per endpoint, moving between those pages for a minute — or two colleagues behind
   * the same office address — ran out, and the page showed its load error for an ordinary visit.
   * A section read is one indexed row, authenticated and permission-checked: 120 a minute.
   */
  @Get(':section')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  get(@Param('section') section: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sections.get(section, user.organizationId);
  }

  @Patch(':section')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  update(
    @Param('section') section: string,
    @Body() dto: UpdateSettingsSectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sections.update(section, user.organizationId, dto);
  }
}
