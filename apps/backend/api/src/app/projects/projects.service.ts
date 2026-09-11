import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { ProjectTask } from './entities/project-task.entity';
import { Timesheet } from './entities/timesheet.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CreateProjectTaskDto } from './dto/create-project-task.dto';
import { UpdateProjectTaskDto } from './dto/update-project-task.dto';
import { CreateTimesheetDto } from './dto/create-timesheet.dto';
import { UpdateTimesheetDto } from './dto/update-timesheet.dto';
import { NotFoundError } from '../i18n/localized.exception';
import { Page, resolvePaging, toPage } from '../common/pagination';

/**
 * Projects, their tasks and timesheets.
 *
 * Declared as entities with no service and no controller. This is the tenant-scoped register.
 * Every query is scoped by `organizationId`; a timesheet records the authenticated user as its
 * author rather than trusting the body.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(ProjectTask)
    private readonly taskRepository: Repository<ProjectTask>,
    @InjectRepository(Timesheet)
    private readonly timesheetRepository: Repository<Timesheet>,
  ) {}

  // ── Projects ─────────────────────────────────────────────────────────────────

  async findAllProjects(
    organizationId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<Page<Project>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const [rows, total] = await this.projectRepository.findAndCount({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      skip: paging.skip,
      take: paging.take,
    });
    return toPage(rows, total, paging);
  }

  async findOneProject(id: string, organizationId: string): Promise<Project> {
    const project = await this.projectRepository.findOne({
      where: { id, organizationId },
    });
    if (!project) {
      throw new NotFoundError('PROJECTS.PROJECT_NOT_FOUND', { id });
    }
    return project;
  }

  createProject(dto: CreateProjectDto, organizationId: string): Promise<Project> {
    const project = this.projectRepository.create({ ...dto, organizationId });
    return this.projectRepository.save(project);
  }

  async updateProject(
    id: string,
    dto: UpdateProjectDto,
    organizationId: string,
  ): Promise<Project> {
    const project = await this.findOneProject(id, organizationId);
    return this.projectRepository.save(this.projectRepository.merge(project, dto));
  }

  async removeProject(id: string, organizationId: string): Promise<void> {
    await this.findOneProject(id, organizationId);
    await this.projectRepository.delete({ id, organizationId });
  }

  // ── Tasks ────────────────────────────────────────────────────────────────────

  async findTasks(organizationId: string, projectId?: string): Promise<ProjectTask[]> {
    return this.taskRepository.find({
      where: { organizationId, ...(projectId ? { projectId } : {}) },
      order: { dueDate: 'ASC' },
    });
  }

  async findOneTask(id: string, organizationId: string): Promise<ProjectTask> {
    const task = await this.taskRepository.findOne({ where: { id, organizationId } });
    if (!task) {
      throw new NotFoundError('PROJECTS.TASK_NOT_FOUND', { id });
    }
    return task;
  }

  async createTask(dto: CreateProjectTaskDto, organizationId: string): Promise<ProjectTask> {
    // The task's project must belong to the same tenant, or a task could be attached across the
    // boundary. `findOneProject` throws if it does not.
    await this.findOneProject(dto.projectId, organizationId);
    const task = this.taskRepository.create({ ...dto, organizationId });
    return this.taskRepository.save(task);
  }

  async updateTask(
    id: string,
    dto: UpdateProjectTaskDto,
    organizationId: string,
  ): Promise<ProjectTask> {
    const task = await this.findOneTask(id, organizationId);
    if (dto.projectId) await this.findOneProject(dto.projectId, organizationId);
    return this.taskRepository.save(this.taskRepository.merge(task, dto));
  }

  async removeTask(id: string, organizationId: string): Promise<void> {
    await this.findOneTask(id, organizationId);
    await this.taskRepository.delete({ id, organizationId });
  }

  // ── Timesheets ───────────────────────────────────────────────────────────────

  async findTimesheets(organizationId: string, projectId?: string): Promise<Timesheet[]> {
    return this.timesheetRepository.find({
      where: { organizationId, ...(projectId ? { projectId } : {}) },
      order: { date: 'DESC' },
    });
  }

  async findOneTimesheet(id: string, organizationId: string): Promise<Timesheet> {
    const timesheet = await this.timesheetRepository.findOne({
      where: { id, organizationId },
    });
    if (!timesheet) {
      throw new NotFoundError('PROJECTS.TIMESHEET_NOT_FOUND', { id });
    }
    return timesheet;
  }

  async createTimesheet(
    dto: CreateTimesheetDto,
    organizationId: string,
    userId: string,
  ): Promise<Timesheet> {
    await this.findOneProject(dto.projectId, organizationId);
    const timesheet = this.timesheetRepository.create({ ...dto, organizationId, userId });
    return this.timesheetRepository.save(timesheet);
  }

  async updateTimesheet(
    id: string,
    dto: UpdateTimesheetDto,
    organizationId: string,
  ): Promise<Timesheet> {
    const timesheet = await this.findOneTimesheet(id, organizationId);
    if (dto.projectId) await this.findOneProject(dto.projectId, organizationId);
    return this.timesheetRepository.save(
      this.timesheetRepository.merge(timesheet, dto),
    );
  }

  async removeTimesheet(id: string, organizationId: string): Promise<void> {
    await this.findOneTimesheet(id, organizationId);
    await this.timesheetRepository.delete({ id, organizationId });
  }
}
