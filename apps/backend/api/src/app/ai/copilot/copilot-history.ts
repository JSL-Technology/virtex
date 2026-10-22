import type Anthropic from '@anthropic-ai/sdk';

type Message = Anthropic.Beta.Messages.BetaMessageParam;
type Block = Record<string, unknown>;

/** Tool results kept verbatim: those of the last few questions; older ones are replaced by a note. */
export const VERBATIM_QUESTIONS = 2;
/** Above this much stored history (characters of JSON), the oldest exchanges are left out. */
export const MAX_HISTORY_CHARS = 120_000;

export const STALE_RESULT_NOTE =
  'Earlier tool result omitted (older than the last questions, or from a tool this person may no longer use). Call the tool again if you need it.';

/**
 * The stored conversation as it is sent again to the model.
 *
 * Every turn replays the history, and the history holds what the tools returned — balances,
 * customers, statements. Replayed verbatim forever, a conversation keeps sending data the person
 * read months ago, including data read under a permission since withdrawn; and it grows until it no
 * longer fits. So:
 *
 *  - a tool result is kept verbatim only if it belongs to one of the last `VERBATIM_QUESTIONS`
 *    questions AND came from a tool the person may still use; any other is replaced by a note
 *    telling the model to call the tool again (which re-checks the permission);
 *  - beyond `MAX_HISTORY_CHARS`, the oldest whole exchanges are dropped, cutting only where a new
 *    question begins, so every tool call keeps its result and the history still starts with a
 *    question.
 *
 * The stored rows are not changed: this shapes only what is sent.
 */
export function historyForModel(stored: Message[], allowedTools: ReadonlySet<string>): Message[] {
  // Where each question (a user turn with text, not a tool-result turn) begins.
  const starts = stored.map((message, index) => (isQuestion(message) ? index : -1)).filter((index) => index >= 0);
  const verbatimFrom = starts.length > VERBATIM_QUESTIONS ? starts[starts.length - VERBATIM_QUESTIONS] : 0;

  // Which tool each tool_use id called, so a result can be judged by its tool.
  const toolOf = new Map<string, string>();
  for (const message of stored) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content as unknown as Block[]) {
      if (block['type'] === 'tool_use') toolOf.set(String(block['id']), String(block['name']));
    }
  }

  const shaped = stored.map((message, index) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return message;
    const content = (message.content as unknown as Block[]).map((block) => {
      if (block['type'] !== 'tool_result') return block;
      const tool = toolOf.get(String(block['tool_use_id']));
      const fresh = index >= verbatimFrom && tool !== undefined && allowedTools.has(tool);
      return fresh ? block : { ...block, content: STALE_RESULT_NOTE, is_error: false };
    });
    return { ...message, content } as unknown as Message;
  });

  // Oldest exchanges out, whole, until it fits.
  let from = 0;
  const size = (list: Message[]) => JSON.stringify(list).length;
  while (size(shaped.slice(from)) > MAX_HISTORY_CHARS) {
    const next = starts.find((start) => start > from);
    if (next === undefined) break;
    from = next;
  }
  return shaped.slice(from);
}

function isQuestion(message: Message): boolean {
  if (message.role !== 'user') return false;
  if (typeof message.content === 'string') return true;
  return (message.content as unknown as Block[]).some((block) => block['type'] === 'text');
}

const SENSITIVE_KEY = /(tax_?id|taxid|rnc|rfc|nit|ein|ssn|cedula|identity|document_?number|email|e_?mail|phone|mobile|account_?number|iban|swift|routing|card_?number|clabe|cbu)/i;

/**
 * A tool's result with identifiers masked — tax identifiers, e-mails, phones, bank and card
 * numbers — keeping the last four characters, enough to tell two parties apart and to answer
 * "the one ending in 4753", not enough to use. Applied when the company keeps `mask_identifiers` on,
 * to every tool but those whose purpose is finding a party by identifier.
 */
export function maskIdentifiers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskIdentifiers);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) && (typeof item === 'string' || typeof item === 'number') ? maskValue(String(item)) : maskIdentifiers(item),
      ]),
    );
  }
  return value;
}

function maskValue(text: string): string {
  if (text.includes('@')) {
    const [local, domain] = text.split('@');
    const tld = domain?.split('.').pop() ?? '';
    return `${local.slice(0, 1)}•••@•••.${tld}`;
  }
  const visible = text.replace(/[\s-]/g, '').slice(-4);
  return text.length <= 4 ? '••••' : `•••${visible}`;
}
