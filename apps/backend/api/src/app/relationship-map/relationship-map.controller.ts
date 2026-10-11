import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { DocumentFlowService } from './document-flow.service';
import { FlowDocumentType } from './contracts/document-flow.contracts';

/**
 * The document relationship map — SAP Business One's «Mapa de relaciones».
 *
 * One read-only route: give it the type and id of any document and it returns the whole chain that
 * document belongs to as a graph the client draws. It is scoped to the caller's tenant by the
 * service, and gated by a single view permission because it can surface a document from any module
 * the chain reaches.
 */
@ApiTags('Relationship map')
@ApiBearerAuth()
@Controller('relationship-map')
export class RelationshipMapController {
  constructor(private readonly flow: DocumentFlowService) {}

  @Get(':type/:id')
  @HasPermission(PERMISSIONS.RELATIONSHIP_MAP_VIEW)
  @ApiOperation({ summary: 'El mapa de relaciones de un documento: toda su cadena, como grafo.' })
  map(
    @Param('type') type: string,
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.flow.buildMap(type as FlowDocumentType, id, user.organizationId);
  }
}
