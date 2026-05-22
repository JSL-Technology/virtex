






import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequence } from './document-sequences/entities/document-sequence.entity';
import { DocumentSequencesService } from './document-sequences/document-sequences.service';
import { OrganizationSubscriber } from './subscribers/organization.subscriber';
import { CryptoUtil } from './utils/crypto.util';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentSequence])
  ], 
  providers: [
    DocumentSequencesService,
    OrganizationSubscriber,
    CryptoUtil
  ],
  exports: [
    DocumentSequencesService,
    OrganizationSubscriber,
    CryptoUtil
  ],
})
export class SharedModule {}