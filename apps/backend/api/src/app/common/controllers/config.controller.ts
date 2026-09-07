import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Industry, CompanySize } from '@virteex/shared/types';
import { AuthenticatedOnly } from '../../auth/decorators/authenticated-only.decorator';

@ApiTags('Config')
@Controller('config')
export class ConfigController {
  @Get('registration-options')
  @AuthenticatedOnly(
    'Static options the signup form renders. Carries no tenant data — the same list for everyone.',
  )
  @ApiOperation({ summary: 'Get registration options (industries, company sizes)' })
  @ApiResponse({ status: 200, description: 'Registration options retrieved successfully' })
  getRegistrationOptions() {
    return {
      industries: Object.values(Industry),
      companySizes: Object.values(CompanySize),
    };
  }
}
