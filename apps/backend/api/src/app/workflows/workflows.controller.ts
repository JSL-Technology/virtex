import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { WorkflowsService, ApprovalActor } from './workflows.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import {
  CreateApprovalPolicyDto,
  DecideApprovalDto,
  RejectApprovalDto,
  UpdateApprovalPolicyDto,
} from './dto/approval-policy.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

/**
 * ## Why every route here carries a permission now
 *
 * `approve` and `reject` used to carry none. The class-level `JwtAuthGuard` establishes that the
 * caller is *somebody*; `PermissionsGuard` only applies where `@HasPermission` puts it. So any
 * authenticated user — a seller, a read-only member, a user of a completely different tenant —
 * could call `POST /workflows/reject/:requestId` with any uuid and refuse another customer's
 * supplier invoice or journal entry. The service compounded it by looking the request up by id
 * alone, with no `organizationId`, and by recording no actor for a rejection.
 *
 * Deciding is `WORKFLOWS_DECIDE`, distinct from `WORKFLOWS_MANAGE`: configuring the policy and
 * applying it are different jobs, and giving the second to whoever holds the first defeats the
 * separation the policy exists to create.
 */
@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  private actor(user: AuthenticatedUser): ApprovalActor {
    return {
      userId: user.id,
      organizationId: user.organizationId,
      // From the authenticated principal, never from the request body.
      roleIds: (user.roles ?? []).map((role) => role.id),
    };
  }

  // ── Deciding ───────────────────────────────────────────────────────────────

  @Get('approvals/pending')
  @HasPermission(PERMISSIONS.WORKFLOWS_DECIDE)
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.workflowsService.pendingFor(user.organizationId);
  }

  /** Who decided what, on which step, and when. */
  @Get('approvals/:requestId/history')
  @HasPermission(PERMISSIONS.WORKFLOWS_DECIDE)
  history(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowsService.historyFor(requestId, user.organizationId);
  }

  @Post('approve/:requestId')
  @HasPermission(PERMISSIONS.WORKFLOWS_DECIDE)
  approve(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: DecideApprovalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowsService.approve(requestId, this.actor(user), dto.comment);
  }

  @Post('reject/:requestId')
  @HasPermission(PERMISSIONS.WORKFLOWS_DECIDE)
  reject(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RejectApprovalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowsService.reject(requestId, this.actor(user), dto.reason);
  }

  // ── Policies ───────────────────────────────────────────────────────────────

  @Post('policies')
  @HasPermission(PERMISSIONS.WORKFLOWS_MANAGE)
  createPolicy(
    @Body() dto: CreateApprovalPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowsService.createPolicy(dto, user.organizationId);
  }

  @Get('policies')
  @HasPermission(PERMISSIONS.WORKFLOWS_MANAGE)
  getPolicies(@CurrentUser() user: AuthenticatedUser) {
    return this.workflowsService.getPolicies(user.organizationId);
  }

  @Patch('policies/:policyId')
  @HasPermission(PERMISSIONS.WORKFLOWS_MANAGE)
  updatePolicy(
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @Body() dto: UpdateApprovalPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowsService.updatePolicy(policyId, dto, user.organizationId);
  }

  @Delete('policies/:policyId')
  @HasPermission(PERMISSIONS.WORKFLOWS_MANAGE)
  deletePolicy(
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowsService.deletePolicy(policyId, user.organizationId);
  }
}
