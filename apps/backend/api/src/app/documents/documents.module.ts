import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentNode } from './entities/document-node.entity';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  // StorageModule is @Global, so `StorageService` is injectable without importing it here.
  imports: [TypeOrmModule.forFeature([DocumentNode]), AuthModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
