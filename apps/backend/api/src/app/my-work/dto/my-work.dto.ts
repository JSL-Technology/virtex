import { ApiProperty } from '@nestjs/swagger';

export class WorkItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  dueDate: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  link: string;
}

export class MyWorkDto {
  @ApiProperty({ type: [WorkItemDto] })
  tasks: WorkItemDto[];

  @ApiProperty({ type: [WorkItemDto] })
  approvals: WorkItemDto[];

  @ApiProperty({ type: [WorkItemDto] })
  notifications: WorkItemDto[];
}
