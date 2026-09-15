import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { HasPermission } from '../../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../../shared/permissions';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { FastifyFileInterceptor } from '../../common/interceptors/fastify-file.interceptor';
import { FastifyFile } from '../../common/interfaces/fastify-file.interface';
import { BadRequestError } from '../../i18n/localized.exception';
import { AuditAdjustmentsService } from './audit-adjustments.service';
import { CreateProposedAdjustmentDto } from '../dto/proposed-adjustment.dto';
import { ListProposedAdjustmentsDto } from '../dto/list-proposed-adjustments.dto';
import { User } from '../../users/entities/user.entity/user.entity';

/** 20 MB. Audit evidence is a working paper or a scan, not a video. */
const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;

/**
 * An external audit's proposed correction to a year that is already closed.
 *
 * ## Why this file had to be written
 *
 * `AuditAdjustmentsService` — the proposal, the approval workflow, the evidence upload, and the
 * listener that posts the entry once it is approved — existed, was documented, and was covered by
 * `audit-adjustment.spec.ts`. It was registered in no module and reachable from no route, and
 * `AdjustmentsService.createAuditAdjustment` (with the retained-earnings transfer that keeps a
 * closed year internally consistent) had no caller but that unregistered listener.
 *
 * So the feature did not exist operationally: an auditor could not propose an adjustment, an
 * approver could not approve one, and the two permissions `audit:propose_adjustment` and
 * `audit:approve_adjustment` sat in the catalogue with nothing declaring them. Nothing in the
 * build noticed, because a provider nobody provides still compiles and its unit tests still pass.
 *
 * ## Why proposing is not approving
 *
 * The two permissions are separate and both are declared here. An auditor proposes; somebody with
 * standing in the organisation approves, through `WorkflowsService`. Where a tenant has defined no
 * approval policy for `AUDIT_ADJUSTMENT` the proposal auto-approves and posts — which is the
 * behaviour of the service, and the reason a tenant that wants four eyes on a closed year has to
 * say so with a policy.
 */
@ApiTags('Audit adjustments')
@ApiBearerAuth()
@Controller('audit/adjustments')
export class AuditAdjustmentsController {
  constructor(private readonly adjustments: AuditAdjustmentsService) {}

  @Get()
  @HasPermission(PERMISSIONS.AUDIT_VIEW_TRAIL)
  @ApiOperation({ summary: 'Lista las propuestas de ajuste de auditoría del inquilino.' })
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: ListProposedAdjustmentsDto) {
    return this.adjustments.findAll(user.organizationId, query);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.AUDIT_VIEW_TRAIL)
  @ApiOperation({ summary: 'Consulta una propuesta de ajuste con su evidencia.' })
  findOne(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adjustments.findOne(id, user.organizationId);
  }

  @Post()
  @HasPermission(PERMISSIONS.AUDIT_PROPOSE_ADJUSTMENT)
  @ApiOperation({ summary: 'Propone un ajuste de auditoría sobre un año fiscal cerrado.' })
  propose(
    @Body() dto: CreateProposedAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // The service takes the proposer as a `User` because the proposal records WHO proposed it —
    // the entry it eventually posts is attributed to them and not to whoever approved it.
    return this.adjustments.proposeAdjustment(dto, user.organizationId, {
      id: user.id,
    } as User);
  }

  @Post(':id/evidence')
  @HasPermission(PERMISSIONS.AUDIT_PROPOSE_ADJUSTMENT)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Adjunta un papel de trabajo a una propuesta pendiente.' })
  @UseInterceptors(FastifyFileInterceptor('file', { limits: { fileSize: MAX_EVIDENCE_BYTES } }))
  addEvidence(
    @Param('id', UuidParamPipe) id: string,
    @UploadedFile() file: FastifyFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestError('audit.attach_evidence_file');
    return this.adjustments.addEvidence(id, file, user.organizationId, user.id);
  }
}
