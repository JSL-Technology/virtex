
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DimensionsService } from './dimensions.service';
import { DimensionsController } from './dimensions.controller';
import { Dimension } from './entities/dimension.entity';
import { DimensionValue } from './entities/dimension-value.entity';
import { AuthModule } from '../auth/auth.module';
import { DimensionRule } from './entities/dimension-rule.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Dimension, 
      DimensionValue,
      DimensionRule
    ]),
    AuthModule
  ],
  controllers: [DimensionsController],
  providers: [DimensionsService],
})
export class DimensionsModule {}