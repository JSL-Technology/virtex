import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { DocumentFlowService, FlowPrincipal } from './document-flow.service';
import { FlowDocumentType } from './contracts/document-flow.contracts';
import { FlowDocumentTypePipe } from './flow-document-type.pipe';
import { RelationshipMapQueryDto, RelationshipMapSearchDto } from './dto/relationship-map.dto';

/**
 * The document relationship map — SAP Business One's «Mapa de relaciones».
 *
 * Read-only. Gated by a single view permission to reach the map at all; what the map then SHOWS is
 * filtered per document by the caller's own module permissions and branch scope (see
 * `DocumentFlowService`), because one chain can cross Ventas, Compras, Contabilidad and Nómina.
 */
@ApiTags('Relationship map')
@ApiBearerAuth()
@Controller('relationship-map')
export class RelationshipMapController {
  constructor(private readonly flow: DocumentFlowService) {}

  @Get('types')
  @HasPermission(PERMISSIONS.RELATIONSHIP_MAP_VIEW)
  @ApiOperation({ summary: 'Los tipos de documento desde los que el usuario puede abrir un mapa.' })
  types(@CurrentUser() user: AuthenticatedUser) {
    return this.flow.documentTypes(principalOf(user));
  }

  @Get('search')
  @HasPermission(PERMISSIONS.RELATIONSHIP_MAP_VIEW)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Busca documentos por número para abrir su mapa.' })
  search(@Query() query: RelationshipMapSearchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.flow.search(query.q, principalOf(user), query.type);
  }

  @Get(':type/:id')
  @HasPermission(PERMISSIONS.RELATIONSHIP_MAP_VIEW)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'El mapa de relaciones de un documento: toda su cadena, como grafo.' })
  map(
    @Param('type', FlowDocumentTypePipe) type: FlowDocumentType,
    @Param('id', UuidParamPipe) id: string,
    @Query() query: RelationshipMapQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.flow.buildMap(type, id, principalOf(user), {
      maxDepth: query.depth,
      maxNodes: query.limit,
    });
  }
}

function principalOf(user: AuthenticatedUser): FlowPrincipal {
  return { organizationId: user.organizationId, userId: user.id ?? null, permissions: user.permissions ?? [] };
}
