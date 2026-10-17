import { IsIn } from 'class-validator';

export const MESSAGE_TONES = ['cordial', 'formal', 'firm'] as const;
export type MessageTone = (typeof MESSAGE_TONES)[number];

export class ComposeInvoiceMessageDto {
  @IsIn(MESSAGE_TONES, { message: 'validation.constraints.is_in' })
  tone: MessageTone;
}
