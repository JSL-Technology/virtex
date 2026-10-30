import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { normaliseRegionalFormat, RegionalFormat } from '@virteex/shared/types';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { RegionalFormatDto } from '../i18n/dto/regional-format.dto';
import { OrgSettingsService } from './services/org-settings.service';

/**
 * The company's regional format: how dates, numbers and times are written for every member who
 * has not chosen otherwise (`RegionalFormat`).
 *
 * Read by every member — the session already carries it, and the preferences screen shows what a
 * person would inherit. Changed with `settings:edit_company`, like the rest of the company's
 * configuration. A `PUT`, not a `PATCH`: the body is the whole preference, and a field left out
 * returns to automatic, which is what «Automático» in the form means.
 */
@ApiTags('Organizations')
@Controller('organizations/regional-format')
export class RegionalFormatController {
  constructor(private readonly settings: OrgSettingsService) {}

  @Get()
  @AuthenticatedOnly('Every member formats dates and numbers with the company default, which the session already carries and which is not sensitive.')
  @ApiOperation({ summary: 'Formato de fechas, números y hora de la empresa.' })
  async get(@CurrentUser() user: AuthenticatedUser): Promise<RegionalFormat> {
    return normaliseRegionalFormat((await this.settings.getForOrg(user.organizationId))?.regionalFormat);
  }

  @Put()
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  @ApiOperation({ summary: 'Cambia el formato de fechas, números y hora de la empresa.' })
  async update(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegionalFormatDto): Promise<RegionalFormat> {
    const format = normaliseRegionalFormat(dto);
    await this.settings.update(user.organizationId, { regionalFormat: Object.keys(format).length ? format : null });
    return format;
  }
}
