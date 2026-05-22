import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApprovalRequest, ApprovalStatus } from '../workflows/entities/approval-request.entity';
import { Repository } from 'typeorm';
import { MyWorkDto, WorkItemDto } from './dto/my-work.dto';

@Injectable()
export class MyWorkService {
  constructor(
    @InjectRepository(ApprovalRequest)
    private readonly approvalRequestRepository: Repository<ApprovalRequest>,
  ) {}

  async getWorkItems(userId: string, organizationId: string): Promise<MyWorkDto> {
    const approvals = await this.getPendingApprovals(userId, organizationId);

    return {
      tasks: [],
      approvals,
      notifications: [],
    };
  }

  private async getPendingApprovals(userId: string, organizationId: string): Promise<WorkItemDto[]> {



    const pendingApprovals = await this.approvalRequestRepository.find({
      where: {
        organizationId,
        status: ApprovalStatus.PENDING,
      },
    });

    return pendingApprovals.map(approval => ({
      id: approval.id,
      title: `Approve ${approval.documentType} #${approval.documentId.substring(0, 8)}`,
      description: `Request for ${approval.documentType} is pending approval.`,
      dueDate: approval.approvedAt?.toISOString() || new Date().toISOString(),
      status: 'pending',
      link: `/approvals/${approval.id}`,
    }));
  }
}