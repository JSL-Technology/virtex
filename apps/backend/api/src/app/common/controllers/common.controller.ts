
import { Controller, Get, Query, Head, NotFoundException, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { UsersService } from '../../users/users.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { Public } from '../../auth/decorators/public.decorator';

@ApiTags('Common')
@Controller('common')
export class CommonController {
  constructor(
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService
  ) {}

  @Head('users/exists')
  @Public()
  @ApiOperation({ summary: 'Check if user email exists' })
  @ApiQuery({ name: 'email', required: true })
  @ApiResponse({ status: 200, description: 'User exists' })
  @ApiResponse({ status: 404, description: 'User does not exist' })
  async checkUserExists(@Query('email') email: string) {
    if (!email) throw new BadRequestException('Email is required');
    const user = await this.usersService.findOneByEmail(email);
    if (!user) throw new NotFoundException();
    return;
  }

  @Head('organizations/exists')
  @Public()
  @ApiOperation({ summary: 'Check if organization tax ID exists' })
  @ApiQuery({ name: 'taxId', required: true })
  @ApiResponse({ status: 200, description: 'Organization exists' })
  @ApiResponse({ status: 404, description: 'Organization does not exist' })
  async checkOrgExists(@Query('taxId') taxId: string) {
      if (!taxId) throw new BadRequestException('Tax ID is required');
      const org = await this.organizationsService.findByTaxId(taxId);
      if (!org) throw new NotFoundException();
      return;
  }
}
