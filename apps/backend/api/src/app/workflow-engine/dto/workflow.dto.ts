import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { WorkflowGraph, WorkflowTrigger } from '../contracts/workflow-graph';
import { WorkflowDefinitionStatus } from '../entities/workflow-definition.entity';
import { WorkflowInstanceStatus } from '../entities/workflow-instance.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * The graph and trigger are accepted as objects here and checked in full by the graph validator:
 * structurally on every save (types, references, limits) and semantically at publish (one start,
 * reachable ends, routed outcomes, known actions and assignees). A per-field decorator cannot see
 * the whole graph, which most of those rules need.
 */
export class CreateWorkflowDefinitionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  key?: string;

  @Transform(trim)
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
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @Transform(trim)
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

  /** The `updatedAt` the editor loaded; a save over a newer version is refused (409). */
  @IsDateString()
  @IsOptional()
  expectedUpdatedAt?: string;
}

export class ValidateDefinitionDto {
  @IsObject()
  graph: WorkflowGraph;

  @IsObject()
  trigger: WorkflowTrigger;
}

export class PublishDefinitionDto {
  /** Publish a version older than the live one, on purpose. */
  @IsBoolean()
  @IsOptional()
  rollback?: boolean;
}

export class DuplicateDefinitionDto {
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;
}

export class ListDefinitionsQueryDto {
  @IsEnum(WorkflowDefinitionStatus)
  @IsOptional()
  status?: WorkflowDefinitionStatus;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  key?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  search?: string;
}

export class SubjectDto {
  @IsString()
  @IsOptional()
  @MaxLength(60)
  type?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  id?: string;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(200)
  label?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  @Matches(/^\/(?!\/)/)
  route?: string;
}

export class StartInstanceDto {
  @IsObject()
  @IsOptional()
  context?: Record<string, unknown>;

  @ValidateNested()
  @Type(() => SubjectDto)
  @IsOptional()
  subject?: SubjectDto;
}

export class CompleteTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  outcome: string;

  @IsObject()
  @IsOptional()
  formData?: Record<string, unknown>;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  comment?: string;
}

export class CancelInstanceDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason: string;
}

export class FireEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/^[a-z0-9][a-z0-9_.-]*$/)
  event: string;

  @IsObject()
  @IsOptional()
  context?: Record<string, unknown>;

  @ValidateNested()
  @Type(() => SubjectDto)
  @IsOptional()
  subject?: SubjectDto;
}

export class ListInstancesQueryDto {
  @IsEnum(WorkflowInstanceStatus)
  @IsOptional()
  status?: WorkflowInstanceStatus;

  @IsUUID()
  @IsOptional()
  definitionId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  key?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  search?: string;

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  /** `mine`: only runs this person started or has a task in. */
  @IsIn(['all', 'mine'])
  @IsOptional()
  scope?: 'all' | 'mine';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number;
}

export class AssigneeQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;

  /** Resolve these people by id (comma-separated) — the ones a saved graph already references. */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value ?? '').split(',')).map((v: string) => v.trim()).filter(Boolean))
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids?: string[];
}
