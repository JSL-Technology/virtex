
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './entities/project.entity';
import { ProjectTask } from './entities/project-task.entity';
import { Timesheet } from './entities/timesheet.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectTask,
      Timesheet
    ])
  ]
})
export class ProjectsModule {}
