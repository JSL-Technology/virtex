import { Module } from '@nestjs/common';
import { DocumentFlowService } from './document-flow.service';
import { RelationshipMapController } from './relationship-map.controller';

/**
 * The relationship map reads across Ventas, Compras and Contabilidad but imports none of them: it
 * owns no tables and registers no repositories, reaching the documents' links through the global
 * `DataSource` and TypeORM's runtime metadata (see {@link DocumentFlowService}). That is what keeps
 * a cross-module read in the `reportes` layer from becoming a cross-module dependency.
 */
@Module({
  providers: [DocumentFlowService],
  controllers: [RelationshipMapController],
  exports: [DocumentFlowService],
})
export class RelationshipMapModule {}
