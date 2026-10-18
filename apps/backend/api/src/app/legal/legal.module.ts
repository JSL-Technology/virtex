import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';
import { MarketWaitlistEntry } from './market-waitlist.entity';

/** Legal pages' server side and the not-yet-served-market waitlist (QA C-08, A-13). */
@Module({
  imports: [TypeOrmModule.forFeature([MarketWaitlistEntry])],
  controllers: [LegalController],
  providers: [LegalService],
})
export class LegalModule {}
