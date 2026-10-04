import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BranchesService } from './services/branches.service';
import { CreateBranchDto, SetUserBranchAccessDto, UpdateBranchDto } from './dto/branch.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { StepUp } from '../auth/decorators/step-up.decorator';
import { StepUpScope } from '../auth/enums/step-up-scope.enum';

/**
 * The company's branches, and which of them each person may work in.
 *
 * Declared before any `:id` route on purpose: `mine` and `access/:userId` are literal paths.
 */
@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations/branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get('mine')
  @AuthenticatedOnly(
    'Las sucursales en las que la propia persona puede emitir documentos: lo que necesita cualquier selector de sucursal, sin exponer direcciones ni códigos fiscales.',
  )
  @ApiOperation({ summary: 'Sucursales que el usuario puede usar y su sucursal predeterminada.' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.branches.mine(user.organizationId, user.id);
  }

  @Get('access/:userId')
  @HasPermission(PERMISSIONS.BRANCHES_MANAGE)
  getAccess(@Param('userId', UuidParamPipe) userId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.branches.getUserAccess(user.organizationId, userId);
  }

  /** Limiting a person to some branches is an access decision, like changing their roles. */
  @Put('access/:userId')
  @UseGuards(StepUpGuard)
  @StepUp(StepUpScope.MANAGE_ROLES)
  @HasPermission(PERMISSIONS.BRANCHES_MANAGE)
  @ApiOperation({ summary: 'Sucursales en que puede trabajar una persona (vacío = todas) y su predeterminada.' })
  setAccess(
    @Param('userId', UuidParamPipe) userId: string,
    @Body() dto: SetUserBranchAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.branches.setUserAccess(user.organizationId, userId, dto);
  }

  @Get()
  @HasPermission(PERMISSIONS.BRANCHES_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.branches.findAll(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.BRANCHES_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.branches.findOne(id, user.organizationId);
  }

  @Post()
  @HasPermission(PERMISSIONS.BRANCHES_MANAGE)
  @ApiOperation({ summary: 'Crea una sucursal. La primera es la casa matriz.' })
  create(@Body() dto: CreateBranchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.branches.create(dto, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.BRANCHES_MANAGE)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.branches.update(id, dto, user.organizationId);
  }

  /** Refused once anything was issued from the branch; deactivate it instead. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.BRANCHES_MANAGE)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.branches.remove(id, user.organizationId);
  }
}
