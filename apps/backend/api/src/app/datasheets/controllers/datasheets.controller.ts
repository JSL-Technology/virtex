
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards
} from '@nestjs/common';
import { DatasheetsService } from '../services/datasheets.service';
import { DatasheetVariablesService } from '../services/datasheet-variables.service';
import { DatasheetImportService } from '../services/datasheet-import.service';
import { DatasheetBook } from '../entities/datasheet-book.entity';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity/user.entity';
import { JwtAuthGuard } from '../../auth/guards/jwt/jwt.guard';

@Controller('datasheets')
@UseGuards(JwtAuthGuard)
export class DatasheetsController {
  constructor(
    private readonly datasheetsService: DatasheetsService,
    private readonly variablesService: DatasheetVariablesService,
    private readonly importService: DatasheetImportService
  ) {}

  @Get('import/modules')
  getImportModules() {
    return this.importService.getAvailableModules();
  }

  @Post('import/data')
  importData(
    @Body() body: { module: string, set: string, columns: string[], filters: any },
    @CurrentUser() user: User
  ) {
    return this.importService.importData(body.module, body.set, body.columns, body.filters, user);
  }

  @Get('variables')
  getVariables() {
    return this.variablesService.getRegistry();
  }

  @Post('resolve-variables')
  resolveVariables(
    @Body('variables') variables: { name: string, params: any[] }[],
    @CurrentUser() user: User
  ) {
    return this.variablesService.resolveBatch(variables, user);
  }

  @Post()
  create(@Body() data: Partial<DatasheetBook>, @CurrentUser() user: User) {
    return this.datasheetsService.create(data, user);
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.datasheetsService.findAll(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.datasheetsService.findOne(id, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() data: Partial<DatasheetBook>,
    @CurrentUser() user: User
  ) {
    return this.datasheetsService.update(id, data, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.datasheetsService.remove(id, user);
  }

  @Post(':id/versions')
  createVersion(
    @Param('id') id: string,
    @Body('comment') comment: string,
    @CurrentUser() user: User
  ) {
    return this.datasheetsService.createVersion(id, comment, user);
  }

  @Get(':id/versions')
  getVersions(@Param('id') id: string, @CurrentUser() user: User) {
    return this.datasheetsService.getVersions(id, user);
  }
}
