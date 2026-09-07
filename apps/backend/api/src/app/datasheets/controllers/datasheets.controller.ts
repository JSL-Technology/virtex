
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
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ImportDatasetDto, ResolveVariablesDto } from '../dto/datasheet-variables.dto';

@Controller('datasheets')
@UseGuards(JwtAuthGuard)
export class DatasheetsController {
  constructor(
    private readonly datasheetsService: DatasheetsService,
    private readonly variablesService: DatasheetVariablesService,
    private readonly importService: DatasheetImportService
  ) {}

  /** Only the datasets this caller may actually read. */
  @Get('import/modules')
  getImportModules(@CurrentUser() user: AuthenticatedUser) {
    return this.importService.getAvailableModules(user);
  }

  /**
   * Pull a page of one dataset.
   *
   * The permission is checked per dataset inside the service — a single route-level permission
   * cannot express "products need `products:view` and invoices need `invoices:view`".
   */
  @Post('import/data')
  importData(@Body() dto: ImportDatasetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.importService.importData(dto.module, dto.set, dto.columns, user, {
      page: dto.page,
      pageSize: dto.pageSize,
    });
  }

  @Get('variables')
  getVariables() {
    return this.variablesService.getRegistry();
  }

  /**
   * Resolve variables for a sheet.
   *
   * Each variable carries its own permission and the service enforces it, which is why this route
   * has none of its own: the answer differs per variable, and a route-level gate would either be
   * too coarse to protect EBITDA or too strict to let anyone read the company's name.
   */
  @Post('resolve-variables')
  resolveVariables(@Body() dto: ResolveVariablesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.variablesService.resolveBatch(dto.variables, user);
  }

  @Post()
  create(@Body() data: Partial<DatasheetBook>, @CurrentUser() user: AuthenticatedUser) {
    return this.datasheetsService.create(data, user);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.datasheetsService.findAll(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.datasheetsService.findOne(id, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() data: Partial<DatasheetBook>,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.datasheetsService.update(id, data, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.datasheetsService.remove(id, user);
  }

  @Post(':id/versions')
  createVersion(
    @Param('id') id: string,
    @Body('comment') comment: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.datasheetsService.createVersion(id, comment, user);
  }

  @Get(':id/versions')
  getVersions(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.datasheetsService.getVersions(id, user);
  }
}
