
import { Injectable, NotFoundException, ForbiddenException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalPolicy, DocumentTypeForApproval } from './entities/approval-policy.entity';
import { ApprovalRequest, ApprovalStatus } from './entities/approval-request.entity';
import { CreateApprovalPolicyDto, UpdateApprovalPolicyDto } from './dto/approval-policy.dto';

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectRepository(ApprovalPolicy)
    private policyRepository: Repository<ApprovalPolicy>,
    @InjectRepository(ApprovalRequest)
    private requestRepository: Repository<ApprovalRequest>,
  ) {}





  async createPolicy(dto: CreateApprovalPolicyDto, organizationId: string): Promise<ApprovalPolicy> {
    const policy = this.policyRepository.create({ ...dto, organizationId });
    return this.policyRepository.save(policy);
  }

  async getPolicies(organizationId: string): Promise<ApprovalPolicy[]> {
      return this.policyRepository.find({ where: { organizationId }, relations: ['steps'] });
  }

  async updatePolicy(policyId: string, dto: UpdateApprovalPolicyDto, organizationId: string): Promise<ApprovalPolicy> {
      const policy = await this.policyRepository.findOneBy({ id: policyId, organizationId });
      if (!policy) throw new NotFoundException('Política de aprobación no encontrada.');
      
      const updatedPolicy = this.policyRepository.merge(policy, dto);
      return this.policyRepository.save(updatedPolicy);
  }

  async deletePolicy(policyId: string, organizationId: string): Promise<void> {
      const result = await this.policyRepository.delete({ id: policyId, organizationId });
      if (result.affected === 0) throw new NotFoundException('Política de aprobación no encontrada.');
  }





  async startApprovalProcess(
    organizationId: string,
    documentId: string,
    documentType: DocumentTypeForApproval,
    amount: number,
  ): Promise<ApprovalRequest | null> {
    const policy = await this.policyRepository.findOne({
      where: { organizationId, documentType },
      relations: ['steps'],
      order: { steps: { order: 'ASC' } },
    });

    if (!policy || policy.steps.length === 0) {
      return null;
    }

    const firstStep = policy.steps.find(step => amount >= step.minAmount);
    if (!firstStep) {
        return null;
    }

    const newRequest = this.requestRepository.create({
      organizationId,
      documentId,
      documentType,
      policyId: policy.id,
      status: ApprovalStatus.PENDING,
      currentStep: firstStep.order,
    });
    return this.requestRepository.save(newRequest);
  }

  async approve(requestId: string, userId: string, userRoles: string[]): Promise<ApprovalRequest> {
    const request = await this.requestRepository.findOneBy({ id: requestId });
    if (!request) throw new NotFoundException('Solicitud de aprobación no encontrada.');
    if (request.status !== ApprovalStatus.PENDING) {
        throw new BadRequestException('La solicitud ya ha sido procesada.');
    }

    const policy = await this.policyRepository.findOne({ where: { id: request.policyId }, relations: ['steps'] });
    
    if (!policy) {
      throw new InternalServerErrorException(`No se encontró la política de aprobación con ID "${request.policyId}" asociada a esta solicitud.`);
    }

    const currentStepConfig = policy.steps.find(s => s.order === request.currentStep);

    if (!currentStepConfig || !userRoles.includes(currentStepConfig.roleId)) {
      throw new ForbiddenException('No tienes permisos para aprobar este paso.');
    }

    const nextStep = policy.steps.find(s => s.order > request.currentStep);
    
    if (nextStep) {
        request.currentStep = nextStep.order;
    } else {
        request.status = ApprovalStatus.APPROVED;
        request.approvedByUserId = userId;
        request.approvedAt = new Date();
    }
    
    return this.requestRepository.save(request);
  }

  async reject(requestId: string, reason: string): Promise<ApprovalRequest> {
    const request = await this.requestRepository.findOneBy({ id: requestId });
    if (!request) throw new NotFoundException('Solicitud no encontrada.');

    request.status = ApprovalStatus.REJECTED;
    request.rejectionReason = reason;
    return this.requestRepository.save(request);
  }
}