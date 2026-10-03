import { ApiProperty } from '@nestjs/swagger';

/**
 * One item of «Mi trabajo». Carries catalogue keys, not sentences: the title used to be built here
 * in English («Approve VENDOR_BILL #1a2b3c4d») for a Spanish interface (QA A-11, M-17).
 */
export class WorkItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Catalogue key of the kind of document.' })
  titleKey: string;

  @ApiProperty({ description: 'Document number, counterparty and amount, for the title.' })
  titleParams: Record<string, unknown>;

  @ApiProperty({ nullable: true, description: 'Since when it waits (ISO date), when known.' })
  dueDate: string | null;

  @ApiProperty()
  status: string;

  @ApiProperty({ nullable: true, description: 'Client route of the document, without the company prefix.' })
  route: string | null;
}

export class MyWorkDto {
  @ApiProperty({ type: [WorkItemDto] })
  tasks: WorkItemDto[];

  @ApiProperty({ type: [WorkItemDto] })
  approvals: WorkItemDto[];

  @ApiProperty({ type: [WorkItemDto] })
  notifications: WorkItemDto[];
}
