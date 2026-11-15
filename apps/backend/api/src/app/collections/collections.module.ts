import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesModule } from '../invoices/invoices.module';
import { MailModule } from '../mail/mail.module';
import { WorkflowEngineModule } from '../workflow-engine/workflow-engine.module';
import { CollectionActivity } from './entities/collection-activity.entity';
import { CollectionsService } from './collections.service';
import { CollectionsController } from './collections.controller';
import { CollectionsCopilotTools } from './collections.copilot-tools';
import { CollectionsWorkflowActions } from './collections.workflow-actions';
import { AutomaticRemindersService } from './automatic-reminders.service';
import { AutomaticRemindersScheduler } from './automatic-reminders.scheduler';

/**
 * Sales › Collections: the ranked worklist, what was done to collect, and payment reminders — the
 * ones a person sends and the ones the company's schedule sends on its own. Reads invoices and
 * customers (its own domain); the payment likelihoods come from the AI module through
 * `PaymentLikelihoodRegistry`, and the assistant's note through `AiAssistPort`, on the plans that
 * include it (`ai_collections`).
 */
@Module({
  imports: [TypeOrmModule.forFeature([CollectionActivity]), InvoicesModule, MailModule, WorkflowEngineModule],
  controllers: [CollectionsController],
  providers: [
    CollectionsService,
    CollectionsCopilotTools,
    CollectionsWorkflowActions,
    AutomaticRemindersService,
    AutomaticRemindersScheduler,
  ],
  exports: [CollectionsService],
})
export class CollectionsModule {}
