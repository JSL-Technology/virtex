import { Module } from '@nestjs/common';
import { DocumentFlowCatalog } from './document-flow.catalog';
import { DocumentFlowService } from './document-flow.service';
import { FlowDocumentTypePipe } from './flow-document-type.pipe';
import { RelationshipMapController } from './relationship-map.controller';

/**
 * The relationship map reads across Ventas, Compras, Tesorería, Inventario, Nómina and Contabilidad
 * but imports none of them: it owns no tables and registers no repositories, reaching the
 * documents' links through the global `DataSource` and TypeORM's runtime metadata (see
 * {@link DocumentFlowCatalog}). That is what keeps a cross-module read in the `reportes` layer from
 * becoming a cross-module dependency.
 */
@Module({
  providers: [DocumentFlowCatalog, DocumentFlowService, FlowDocumentTypePipe],
  controllers: [RelationshipMapController],
  exports: [DocumentFlowService],
})
export class RelationshipMapModule {}
