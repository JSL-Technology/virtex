

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { BatchDeactivateAccountsDto } from './dto/batch-operations.dto';
import { MergeAccountsDto } from './dto/merge-accounts.dto';

@Controller('chart-of-accounts')
@UseGuards(JwtAuthGuard)
export class ChartOfAccountsController {
  constructor(
    private readonly chartOfAccountsService: ChartOfAccountsService,
  ) {}

  @Post()
  create(
    @Body() createAccountDto: CreateAccountDto,
    @CurrentUser() user: User,
  ) {
    return this.chartOfAccountsService.create(
      createAccountDto,
      user.organizationId,
    );
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.chartOfAccountsService.findAllForOrg(user.organizationId);
  }

  @Get('tree/roots')
  findTreeRoots(
    @CurrentUser() user: User,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    return this.chartOfAccountsService.findTreeRoots(user.organizationId, {
      page,
      limit,
    });
  }

  @Get('tree/children/:parentId')
  findTreeChildren(
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @CurrentUser() user: User,
  ) {
    return this.chartOfAccountsService.findChildrenOf(
      parentId,
      user.organizationId,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.chartOfAccountsService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAccountDto: UpdateAccountDto,
    @CurrentUser() user: User,
  ) {


    return this.chartOfAccountsService.update(
      id,
      updateAccountDto,
      user.organizationId,
      user.id,
    );
  }

  @Patch(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.chartOfAccountsService.deactivate(id, user.organizationId);
  }

  @Patch(':id/block')
  @HttpCode(HttpStatus.OK)
  block(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.chartOfAccountsService.blockForPosting(
      id,
      user.organizationId,
      user.id,
    );
  }

  @Patch(':id/unblock')
  @HttpCode(HttpStatus.OK)
  unblock(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.chartOfAccountsService.unblockForPosting(
      id,
      user.organizationId,
      user.id,
    );
  }

  @Post('batch/deactivate')
  @HttpCode(HttpStatus.OK)
  batchDeactivate(
    @Body() dto: BatchDeactivateAccountsDto,
    @CurrentUser() user: User,
  ) {
    return this.chartOfAccountsService.batchDeactivate(
      dto.accountIds,
      user.organizationId,
    );
  }

  @Post('merge')
  @HttpCode(HttpStatus.OK)
  mergeAccounts(@Body() mergeDto: MergeAccountsDto, @CurrentUser() user: User) {
    return this.chartOfAccountsService.merge(
      mergeDto,
      user.organizationId,
      user.id,
    );
  }
}
