import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { WorkflowGraph, WorkflowTrigger } from '../contracts/workflow-graph';
import { WorkflowInstanceStatus } from '../entities/workflow-instance.entity';

/**
 * The graph and trigger are validated as free-form objects here and checked for coherence by
 * `WorkflowDefinitionsService.validateGraph` at publish time — the structural rules (one start, a
 * reachable end, known actions) need the whole graph and the action registry, which a per-field
 * decorator cannot see.
 */
export class CreateWorkflowDefinitionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  key?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string | null;

  @IsObject()
  @IsOptional()
  graph?: WorkflowGraph;

  @IsObject()
  @IsOptional()
  trigger?: WorkflowTrigger;
}

export class UpdateWorkflowDefinitionDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string | null;

  @IsObject()
  @IsOptional()
  graph?: WorkflowGraph;

  @IsObject()
  @IsOptional()
  trigger?: WorkflowTrigger;
}

export class StartInstanceDto {
  @IsObject()
  @IsOptional()
  context?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  subject?: { type?: string; id?: string; label?: string };
}

export class CompleteTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  outcome: string;

  @IsObject()
  @IsOptional()
  formData?: Record<string, unknown>;
}

export class FireEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  event: string;

  @IsObject()
  @IsOptional()
  context?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  subject?: { type?: string; id?: string; label?: string };
}

export class ListInstancesQueryDto {
  @IsEnum(WorkflowInstanceStatus)
  @IsOptional()
  status?: WorkflowInstanceStatus;

  @IsString()
  @IsOptional()
  definitionId?: string;
}
