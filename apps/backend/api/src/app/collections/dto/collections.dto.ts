import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MESSAGE_TONES, MessageTone } from '../../invoices/dto/compose-invoice-message.dto';
import { CALL_OUTCOMES, CallOutcome, COLLECTION_CHANNELS, CollectionChannel } from '../entities/collection-activity.entity';
import { CollectionAction } from '../collection-priority';

export const WORKLIST_ACTIONS: readonly CollectionAction[] = ['call', 'firm_reminder', 'reminder', 'courtesy_reminder', 'await_promise', 'wait', 'none'];

export class CollectionsWorklistQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'validation.constraints.is_uuid' })
  branchId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'validation.constraints.is_uuid' })
  customerId?: string;

  @IsOptional()
  @IsIn(WORKLIST_ACTIONS, { message: 'validation.constraints.is_in' })
  action?: CollectionAction;

  /** Only invoices at least this many days past due (negative: due within that many days). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'validation.constraints.is_int' })
  @Min(-60, { message: 'validation.constraints.min|{"min":-60}' })
  @Max(3650, { message: 'validation.constraints.max|{"max":3650}' })
  minDaysOverdue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'validation.constraints.is_int' })
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(200, { message: 'validation.constraints.max|{"max":200}' })
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'validation.constraints.is_int' })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  offset?: number;
}

/** A call, a promise or a note. Reminders are sent (or drafted) through their own routes. */
export class LogCollectionActivityDto {
  @IsUUID('4', { message: 'validation.constraints.is_uuid' })
  invoiceId: string;

  @IsIn(['CALL', 'PROMISE', 'NOTE'], { message: 'validation.constraints.is_in' })
  kind: 'CALL' | 'PROMISE' | 'NOTE';

  @IsOptional()
  @IsIn(COLLECTION_CHANNELS, { message: 'validation.constraints.is_in' })
  channel?: CollectionChannel;

  @IsOptional()
  @IsIn(CALL_OUTCOMES, { message: 'validation.constraints.is_in' })
  outcome?: CallOutcome;

  /** The day the customer said they would pay. Required for a promise; a call may carry one too. */
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'validation.constraints.is_date_string' })
  promisedDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.constraints.is_number' })
  @IsPositive({ message: 'validation.constraints.is_positive' })
  promisedAmount?: number;

  @IsOptional()
  @IsString({ message: 'validation.constraints.is_string' })
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  message?: string;
}

export class ComposeReminderDto {
  @IsIn(MESSAGE_TONES, { message: 'validation.constraints.is_in' })
  tone: MessageTone;
}

export class SaveReminderDraftDto {
  @IsOptional()
  @IsIn(MESSAGE_TONES, { message: 'validation.constraints.is_in' })
  tone?: MessageTone;

  @IsOptional()
  @IsString({ message: 'validation.constraints.is_string' })
  @MaxLength(2000, { message: 'validation.constraints.max_length|{"max":2000}' })
  message?: string;

  @IsOptional()
  @IsEmail({}, { message: 'validation.constraints.is_email' })
  @MaxLength(320, { message: 'validation.constraints.max_length|{"max":320}' })
  to?: string;
}

export class SendReminderDto extends SaveReminderDraftDto {
  /** The draft this send completes, when there is one. */
  @IsOptional()
  @IsUUID('4', { message: 'validation.constraints.is_uuid' })
  draftId?: string;
}
