
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnitOfMeasure } from './entities/unit-of-measure.entity';

import { UnitsOfMeasureService } from './units-of-measure.service';
import { UnitsOfMeasureController } from './units-of-measure.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UnitOfMeasure])],
  providers: [UnitsOfMeasureService],
  controllers: [UnitsOfMeasureController],
})
export class UnitsOfMeasureModule {}