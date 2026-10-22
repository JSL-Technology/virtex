/** The reminder writer's instructions, kept apart so the AI evaluation can load them without the service. */
import type { MessageTone } from '../invoices/dto/compose-invoice-message.dto';

/** Stable, so it is served from the prompt cache; everything per-invoice travels as facts. */
export const REMINDER_SYSTEM =
  'You write the personal note in the body of a payment reminder e-mail from a company to its customer. ' +
  'At most 700 characters, two short paragraphs at most, no greeting line (the template greets the customer), ' +
  'no signature beyond the sender\'s first name if given, and no threats, penalties or legal language. ' +
  'Mention the invoice number and the outstanding balance; mention the due date and how overdue it is when ' +
  'relevant. Invite the customer to reply if they have already paid or need to agree a date. Return an empty subject.';

export const REMINDER_TONES: Record<MessageTone, string> = {
  cordial: 'Tone: warm and friendly, assuming good faith; a gentle reminder.',
  formal: 'Tone: formal and courteous, as in business correspondence.',
  firm: 'Tone: firm but respectful: clear about the amount owed and that payment is now expected, without threats.',
};
