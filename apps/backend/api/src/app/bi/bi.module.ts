import { Module } from '@nestjs/common';
import { BiService } from './bi.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeDimension } from './entities/time-dimension.entity';
import { SalesCubeView } from './entities/sales-cube-view.entity';
import { BiController } from './bi.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TimeDimension, SalesCubeView])],
  providers: [BiService],
  exports: [BiService],
  controllers: [BiController],
})
export class BiModule {}
