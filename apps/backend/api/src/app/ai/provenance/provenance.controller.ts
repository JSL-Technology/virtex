import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { hasPermission } from '@virteex/shared/util-auth';
import { AuthenticatedOnly } from '../../security/decorators/authenticated-only.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { PERMISSIONS } from '../../shared/permissions';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ForbiddenError, NotFoundError } from '../../i18n/localized.exception';
import { aiProvenanceOf } from '../../contracts/ai/provenance.contract';

/** The permission that lets a person read each kind of record — and so where it came from. */
const READ_PERMISSION: Record<string, string> = {
  invoice: PERMISSIONS.INVOICES_VIEW,
  quote: PERMISSIONS.INVOICES_VIEW,
  purchase_order: PERMISSIONS.PROCUREMENT_VIEW,
  vendor_bill: PERMISSIONS.ACCOUNTS_PAYABLE_VIEW,
  collection_draft: PERMISSIONS.AI_COLLECTIONS_VIEW,
  sales_order: PERMISSIONS.INVOICES_VIEW,
  bank_statement_line: PERMISSIONS.ACCOUNTS_PAYABLE_VIEW,
};

/**
 * Where a record came from, when the AI had a hand in it: the badge on the invoice, the order or
 * the bill ("Proposed by the assistant", "Read from the supplier's PDF — 2 fields corrected").
 */
@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai/provenance')
export class ProvenanceController {
  constructor(private readonly dataSource: DataSource) {}

  @Get(':entityType/:entityId')
  @AuthenticatedOnly(
    'Each kind of record is checked against the permission that reads it (READ_PERMISSION); an\n' +
      'unknown kind is refused. It returns only where the record came from, never its content.',
  )
  @ApiOperation({ summary: 'Whether the AI proposed or filled a record, and what a person changed.' })
  async of(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType') entityType: string,
    @Param('entityId', UuidParamPipe) entityId: string,
  ) {
    const permission = READ_PERMISSION[entityType];
    if (!permission) throw new NotFoundError('ai.provenance.unknown_record_type');
    if (!hasPermission(user.permissions ?? [], [permission])) throw new ForbiddenError('auth.you_do_not_have_permission_perform');
    const rows = await aiProvenanceOf(this.dataSource.manager, user.organizationId, entityType, entityId);
    return rows.map((row) => ({ source: row.source, fields: row.fields, createdAt: row.createdAt, agentRunId: row.agentRunId }));
  }
}
