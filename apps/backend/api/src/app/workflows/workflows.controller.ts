
import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  Delete,
  Get,
  Patch,
} from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CreateApprovalPolicyDto, UpdateApprovalPolicyDto } from './dto/approval-policy.dto';

@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post('approve/:requestId')
  approve(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: User,
  ) {
    const userRoles = user.roles.map((r) => r.id);
    return this.workflowsService.approve(requestId, user.id, userRoles);
  }

  @Post('reject/:requestId')
  reject(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body('reason') reason: string,
  ) {
    return this.workflowsService.reject(requestId, reason);
  }


  @Post('policies')
  @HasPermission(PERMISSIONS.WORKFLOWS_MANAGE)
  createPolicy(
    @Body() dto: CreateApprovalPolicyDto,
    @CurrentUser() user: User,
  ) {
    return this.workflowsService.createPolicy(dto, user.organizationId);
  }

  @Get('policies')
  @HasPermission(PERMISSIONS.WORKFLOWS_MANAGE)
  getPolicies(@CurrentUser() user: User) {
    return this.workflowsService.getPolicies(user.organizationId);
  }

  @Patch('policies/:policyId')
  @HasPermission(PERMISSIONS.WORKFLOWS_MANAGE)
  updatePolicy(
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @Body() dto: UpdateApprovalPolicyDto,
    @CurrentUser() user: User,
  ) {
    return this.workflowsService.updatePolicy(
      policyId,
      dto,
      user.organizationId,
    );
  }

  @Delete('policies/:policyId')
  @HasPermission(PERMISSIONS.WORKFLOWS_MANAGE)
  deletePolicy(
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @CurrentUser() user: User,
  ) {
    return this.workflowsService.deletePolicy(policyId, user.organizationId);
  }
}
