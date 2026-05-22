import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Case } from './entities/case.entity';
import { KnowledgeBaseArticle } from './entities/knowledge-base-article.entity';
import { CasesService } from './cases.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CasesController } from './cases.controller';
import { CustomerPortalController } from './customer-portal.controller';
import { InvoicesModule } from '../invoices/invoices.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Case, KnowledgeBaseArticle]),
    InvoicesModule,
    AuthModule,
  ],
  providers: [CasesService, KnowledgeBaseService],
  controllers: [CasesController, CustomerPortalController],
})
export class CustomerServiceModule {}