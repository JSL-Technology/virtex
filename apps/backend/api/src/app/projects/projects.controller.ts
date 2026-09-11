import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CreateProjectTaskDto } from './dto/create-project-task.dto';
import { UpdateProjectTaskDto } from './dto/update-project-task.dto';
import { CreateTimesheetDto } from './dto/create-timesheet.dto';
import { UpdateTimesheetDto } from './dto/update-timesheet.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ── Projects ─────────────────────────────────────────────────────────────────

  @Get()
  @HasPermission(PERMISSIONS.PROJECTS_VIEW)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.projectsService.findAllProjects(user.organizationId, { page, pageSize });
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.PROJECTS_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.findOneProject(id, user.organizationId);
  }

  @Post()
  @HasPermission(PERMISSIONS.PROJECTS_MANAGE)
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.createProject(dto, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.PROJECTS_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.updateProject(id, dto, user.organizationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.PROJECTS_MANAGE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.removeProject(id, user.organizationId);
  }

  // ── Tasks ────────────────────────────────────────────────────────────────────

  @Get('tasks/list')
  @HasPermission(PERMISSIONS.PROJECTS_VIEW)
  findTasks(
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.projectsService.findTasks(user.organizationId, projectId);
  }

  @Post('tasks')
  @HasPermission(PERMISSIONS.PROJECTS_MANAGE)
  createTask(@Body() dto: CreateProjectTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.createTask(dto, user.organizationId);
  }

  @Patch('tasks/:id')
  @HasPermission(PERMISSIONS.PROJECTS_MANAGE)
  updateTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.updateTask(id, dto, user.organizationId);
  }

  @Delete('tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.PROJECTS_MANAGE)
  removeTask(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.removeTask(id, user.organizationId);
  }

  // ── Timesheets ───────────────────────────────────────────────────────────────

  @Get('timesheets/list')
  @HasPermission(PERMISSIONS.PROJECTS_VIEW)
  findTimesheets(
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.projectsService.findTimesheets(user.organizationId, projectId);
  }

  @Post('timesheets')
  @HasPermission(PERMISSIONS.PROJECTS_MANAGE)
  createTimesheet(@Body() dto: CreateTimesheetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.createTimesheet(dto, user.organizationId, user.id);
  }

  @Patch('timesheets/:id')
  @HasPermission(PERMISSIONS.PROJECTS_MANAGE)
  updateTimesheet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTimesheetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.updateTimesheet(id, dto, user.organizationId);
  }

  @Delete('timesheets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.PROJECTS_MANAGE)
  removeTimesheet(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.removeTimesheet(id, user.organizationId);
  }
}
