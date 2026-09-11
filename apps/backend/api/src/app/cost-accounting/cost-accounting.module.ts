import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CostCenter } from './entities/cost-center.entity';
import { CostAccountingService } from './cost-accounting.service';
import { CostAccountingController } from './cost-accounting.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([CostCenter]), AuthModule],
  controllers: [CostAccountingController],
  providers: [CostAccountingService],
  exports: [CostAccountingService],
})
export class CostAccountingModule {}
