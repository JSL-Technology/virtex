






import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequence } from './document-sequences/entities/document-sequence.entity';
import { DocumentSequencesService } from './document-sequences/document-sequences.service';
import { CryptoUtil } from './utils/crypto.util';
import { AfterCommitService } from './after-commit/after-commit.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentSequence])
  ],
  providers: [
    DocumentSequencesService,
    CryptoUtil,
    AfterCommitService,
  ],
  exports: [
    DocumentSequencesService,
    CryptoUtil,
    AfterCommitService,
  ],
})
export class SharedModule {}