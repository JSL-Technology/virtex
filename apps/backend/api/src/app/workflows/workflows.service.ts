
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalPolicy, DocumentTypeForApproval } from './entities/approval-policy.entity';
import { ApprovalRequest, ApprovalStatus } from './entities/approval-request.entity';
import { CreateApprovalPolicyDto, UpdateApprovalPolicyDto } from './dto/approval-policy.dto';
import { BadRequestError, ForbiddenError, InternalServerError, NotFoundError } from '../i18n/localized.exception';

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
      if (!policy) throw new NotFoundError('WORKFLOWS.POLITICA_APROBACION_NO_ENCONTRADA');
      
      const updatedPolicy = this.policyRepository.merge(policy, dto);
      return this.policyRepository.save(updatedPolicy);
  }

  async deletePolicy(policyId: string, organizationId: string): Promise<void> {
      const result = await this.policyRepository.delete({ id: policyId, organizationId });
      if (result.affected === 0) throw new NotFoundError('WORKFLOWS.POLITICA_APROBACION_NO_ENCONTRADA');
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
    if (!request) throw new NotFoundError('WORKFLOWS.SOLICITUD_APROBACION_NO_ENCONTRADA');
    if (request.status !== ApprovalStatus.PENDING) {
        throw new BadRequestError('WORKFLOWS.SOLICITUD_YA_HA_SIDO_PROCESADA');
    }

    const policy = await this.policyRepository.findOne({ where: { id: request.policyId }, relations: ['steps'] });
    
    if (!policy) {
      throw new InternalServerError('WORKFLOWS.NO_ENCONTRO_POLITICA_APROBACION_ID_ASOCIADA_ESTA', { policyId: request.policyId });
    }

    const currentStepConfig = policy.steps.find(s => s.order === request.currentStep);

    if (!currentStepConfig || !userRoles.includes(currentStepConfig.roleId)) {
      throw new ForbiddenError('WORKFLOWS.NO_TIENES_PERMISOS_APROBAR_ESTE_PASO');
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
    if (!request) throw new NotFoundError('WORKFLOWS.SOLICITUD_NO_ENCONTRADA');

    request.status = ApprovalStatus.REJECTED;
    request.rejectionReason = reason;
    return this.requestRepository.save(request);
  }
}