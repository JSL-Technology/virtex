import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { StorageModule } from '../storage/storage.module';
import { InboundMailbox } from './entities/inbound-mailbox.entity';
import { InboundMessage } from './entities/inbound-message.entity';
import { InboundMailService, INBOUND_MAIL_QUEUE } from './inbound-mail.service';
import { InboundMailController } from './inbound-mail.controller';
import { InboundMailProcessor } from './inbound-mail.processor';

/**
 * Mail received at each company's addresses (supplier bills, customer orders). Receives,
 * authenticates, stores and queues; the module registered for each purpose
 * (contracts/inbound-mail) turns a message into drafts.
 */
@Module({
  imports: [TypeOrmModule.forFeature([InboundMailbox, InboundMessage]), BullModule.registerQueue({ name: INBOUND_MAIL_QUEUE }), StorageModule],
  controllers: [InboundMailController],
  providers: [InboundMailService, InboundMailProcessor],
  exports: [InboundMailService],
})
export class InboundMailModule {}
