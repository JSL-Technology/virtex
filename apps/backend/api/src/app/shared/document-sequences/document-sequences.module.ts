import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequence } from './entities/document-sequence.entity';
import { DocumentSequencesService } from './document-sequences.service';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentSequence])],
  providers: [DocumentSequencesService],
  exports: [DocumentSequencesService],
})
export class DocumentSequencesModule {}