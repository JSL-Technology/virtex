import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequence } from './entities/document-sequence.entity';
import { DocumentSequencesService } from './document-sequences.service';
import { DocumentSequencesController } from './document-sequences.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentSequence])],
  controllers: [DocumentSequencesController],
  providers: [DocumentSequencesService],
  exports: [DocumentSequencesService],
})
export class DocumentSequencesModule {}