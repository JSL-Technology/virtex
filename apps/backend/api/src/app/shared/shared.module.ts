






import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequence } from './document-sequences/entities/document-sequence.entity';
import { DocumentSequencesService } from './document-sequences/document-sequences.service';
import { CryptoUtil } from './utils/crypto.util';
import { AfterCommitService } from './after-commit/after-commit.service';
import { Organization } from '../organizations/entities/organization.entity';
import { TenantCountryResolver } from './tenancy/tenant-country.resolver';

@Global()
@Module({
  imports: [
    // `Organization` is registered here only so `TenantCountryResolver` can read it. The
    // resolver is global on purpose: "what country is this tenant in?" was being answered
    // separately — and twice with a hardcoded 'DO' — by payroll, HCM, sales and purchasing.
    TypeOrmModule.forFeature([DocumentSequence, Organization])
  ],
  providers: [
    DocumentSequencesService,
    CryptoUtil,
    AfterCommitService,
    TenantCountryResolver,
  ],
  exports: [
    DocumentSequencesService,
    CryptoUtil,
    AfterCommitService,
    TenantCountryResolver,
  ],
})
export class SharedModule {}