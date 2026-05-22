
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PriceListsService } from './price-lists.service';
import { PriceListsController } from './price-lists.controller';
import { PriceList } from './entities/price-list.entity';
import { PriceListItem } from './entities/price-list-item.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([PriceList, PriceListItem]), AuthModule],
  controllers: [PriceListsController],
  providers: [PriceListsService],
})
export class PriceListsModule {}