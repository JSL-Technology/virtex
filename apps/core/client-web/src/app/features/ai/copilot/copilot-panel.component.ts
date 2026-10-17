import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, Sparkles, X, Plus, History, Trash2, SendHorizontal, Check, ArrowLeft, Square } from 'lucide-angular';
import { Subscription } from 'rxjs';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import {
  CopilotApiService,
  CopilotCapability,
  CopilotConversation,
  CopilotEntry,
  CopilotProposal,
  CopilotRequestError,
} from './copilot-api.service';
import { renderCopilotMarkdown } from './copilot-markdown';

/** One bubble of the conversation as the panel draws it. */
interface PanelMessage {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  toolsUsed: string[];
  proposals: string[];
  /** The answer still being written. */
  streaming?: boolean;
  /** The tool being consulted right now, while streaming. */
  activeTool?: string | null;
  error?: string | null;
}

/** Example questions, offered when the person can use the tool that answers them. */
const SUGGESTIONS: ReadonlyArray<{ tool: string; key: string }> = [
  { tool: 'business_summary', key: 'ai.copilot.suggestion.summary' },
  { tool: 'receivables_aging', key: 'ai.copilot.suggestion.receivables' },
  { tool: 'inventory_forecast', key: 'ai.copilot.suggestion.stockouts' },
  { tool: 'top_sellers_by_branch', key: 'ai.copilot.suggestion.top_sellers' },
  { tool: 'income_statement', key: 'ai.copilot.suggestion.income' },
  { tool: 'draft_quote', key: 'ai.copilot.suggestion.quote' },
];

const MAX_MESSAGE_CHARS = 4000;

/**
 * The copilot panel: a conversation with the ERP, docked at the side of every screen.
 *
 * It answers through the person's own permissions — the server offers the model only the tools
 * this person may use — and it never writes on its own: a draft the model prepares arrives here as
 * a card, and only the person's Confirm creates it (as a draft, for them to review and issue).
 */
@Component({
  selector: 'app-copilot-panel',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES],
  templateUrl: './copilot-panel.component.html',
  styleUrl: './copilot-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'dismissed.emit()' },
})
export class CopilotPanelComponent implements OnInit, OnDestroy {
  private readonly api = inject(CopilotApiService);
  private readonly translate = inject(TranslateService);

  readonly dismissed = output<void>();

  protected readonly CopilotIcon = Sparkles;
  protected readonly CloseIcon = X;
  protected readonly NewIcon = Plus;
  protected readonly HistoryIcon = History;
  protected readonly DeleteIcon = Trash2;
  protected readonly SendIcon = SendHorizontal;
  protected readonly ConfirmIcon = Check;
  protected readonly BackIcon = ArrowLeft;
  protected readonly StopIcon = Square;
  protected readonly MAX_MESSAGE_CHARS = MAX_MESSAGE_CHARS;
  protected readonly k = composeKey;
  protected readonly markdown = renderCopilotMarkdown;

  private readonly messagesEl = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly inputEl = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  readonly capabilities = signal<CopilotCapability[] | null>(null);
  /** Why the copilot cannot be used here (not in the plan, not configured), or null. */
  readonly unavailable = signal<string | null>(null);
  readonly conversations = signal<CopilotConversation[]>([]);
  readonly showHistory = signal(false);
  readonly conversationId = signal<string | null>(null);
  readonly messages = signal<PanelMessage[]>([]);
  readonly proposals = signal<Record<string, CopilotProposal>>({});
  readonly draft = signal('');
  readonly streaming = signal(false);
  readonly loading = signal(false);
  readonly deciding = signal<string | null>(null);

  readonly suggestions = computed(() => {
    const names = new Set((this.capabilities() ?? []).map((tool) => tool.name));
    return SUGGESTIONS.filter((suggestion) => names.has(suggestion.tool)).slice(0, 4);
  });
  readonly canSend = computed(() => {
    const text = this.draft().trim();
    return !!text && text.length <= MAX_MESSAGE_CHARS && !this.streaming() && !this.unavailable();
  });

  private turn: Subscription | null = null;

  ngOnInit(): void {
    this.api.capabilities().subscribe({
      next: (tools) => this.capabilities.set(tools),
      error: (error) => this.unavailable.set(this.messageOf(error)),
    });
    this.loadConversations();
    queueMicrotask(() => this.inputEl()?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    this.turn?.unsubscribe();
  }

  loadConversations(): void {
    this.api.conversations().subscribe({
      next: (list) => this.conversations.set(list),
      error: () => this.conversations.set([]),
    });
  }

  newConversation(): void {
    this.stop();
    this.conversationId.set(null);
    this.messages.set([]);
    this.proposals.set({});
    this.showHistory.set(false);
    queueMicrotask(() => this.inputEl()?.nativeElement.focus());
  }

  open(conversation: CopilotConversation): void {
    this.stop();
    this.showHistory.set(false);
    this.loading.set(true);
    this.api.transcript(conversation.id).subscribe({
      next: (transcript) => {
        this.conversationId.set(transcript.conversation.id);
        this.proposals.set(Object.fromEntries(transcript.proposals.map((proposal) => [proposal.id, proposal])));
        this.messages.set(transcript.entries.map((entry) => this.fromEntry(entry)));
        this.loading.set(false);
        this.scrollToEnd();
      },
      error: (error) => {
        this.loading.set(false);
        this.appendError(this.messageOf(error));
      },
    });
  }

  remove(conversation: CopilotConversation, event: Event): void {
    event.stopPropagation();
    this.api.remove(conversation.id).subscribe({
      next: () => {
        this.conversations.update((list) => list.filter((item) => item.id !== conversation.id));
        if (this.conversationId() === conversation.id) this.newConversation();
      },
    });
  }

  askSuggestion(key: string): void {
    this.ask(this.translate.instant(key));
  }

  ask(text: string): void {
    this.draft.set(text);
    this.send();
  }

  onKeydown(event: KeyboardEvent): void {
    // Enter sends; Shift+Enter is a new line; while composing an accented character, neither.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  send(): void {
    if (!this.canSend()) return;
    const text = this.draft().trim();
    this.draft.set('');
    this.messages.update((list) => [...list, { key: `u-${Date.now()}`, role: 'user', text, toolsUsed: [], proposals: [] }]);
    this.streaming.set(true);
    this.scrollToEnd();

    const existing = this.conversationId();
    if (existing) {
      this.stream(existing, text);
      return;
    }
    this.api.create().subscribe({
      next: (conversation) => {
        this.conversationId.set(conversation.id);
        this.conversations.update((list) => [conversation, ...list]);
        this.stream(conversation.id, text);
      },
      error: (error) => {
        this.streaming.set(false);
        this.appendError(this.messageOf(error));
      },
    });
  }

  /** Stop reading the answer. The server finishes the turn; reopening the conversation shows it. */
  stop(): void {
    if (!this.turn) return;
    this.turn.unsubscribe();
    this.turn = null;
    this.streaming.set(false);
    this.patchAnswer((answer) => ({ ...answer, streaming: false, activeTool: null }));
  }

  confirm(proposal: CopilotProposal): void {
    this.decide(proposal, 'confirm');
  }

  reject(proposal: CopilotProposal): void {
    this.decide(proposal, 'reject');
  }

  proposal(id: string): CopilotProposal | undefined {
    return this.proposals()[id];
  }

  /** The lines of a draft's preview, whatever the document. */
  previewLines(proposal: CopilotProposal): Array<{ description: string; quantity: number; amount: number | null }> {
    const lines = proposal.preview['lines'];
    if (!Array.isArray(lines)) return [];
    return lines.map((line: Record<string, unknown>) => ({
      description: String(line['description'] ?? ''),
      quantity: Number(line['quantity'] ?? 0),
      amount: line['subtotal'] != null ? Number(line['subtotal']) : line['unitPrice'] != null ? Number(line['unitPrice']) * Number(line['quantity'] ?? 0) : null,
    }));
  }

  previewValue(proposal: CopilotProposal, key: string): string | number | null {
    const value = proposal.preview[key];
    return typeof value === 'string' || typeof value === 'number' ? value : null;
  }

  private stream(conversationId: string, text: string): void {
    this.messages.update((list) => [
      ...list,
      { key: `a-${Date.now()}`, role: 'assistant', text: '', toolsUsed: [], proposals: [], streaming: true, activeTool: null },
    ]);
    this.turn = this.api.send(conversationId, text).subscribe({
      next: (event) => {
        switch (event.type) {
          case 'text':
            this.patchAnswer((answer) => ({ ...answer, text: answer.text + event.delta, activeTool: null }));
            break;
          case 'tool':
            this.patchAnswer((answer) => ({
              ...answer,
              activeTool: event.name,
              toolsUsed: answer.toolsUsed.includes(event.name) ? answer.toolsUsed : [...answer.toolsUsed, event.name],
            }));
            break;
          case 'proposal':
            this.proposals.update((map) => ({ ...map, [event.proposal.id]: event.proposal }));
            this.patchAnswer((answer) => ({ ...answer, proposals: [...answer.proposals, event.proposal.id] }));
            break;
          case 'done':
            this.patchAnswer((answer) => ({ ...answer, streaming: false, activeTool: null }));
            if (event.result.stopReason === 'refusal') {
              this.patchAnswer((answer) => ({ ...answer, error: this.translate.instant('ai.copilot.refused') }));
            }
            this.touchConversation(conversationId, text);
            break;
          case 'error':
            this.patchAnswer((answer) => ({ ...answer, streaming: false, activeTool: null, error: event.message || this.translate.instant('ai.copilot.failed') }));
            break;
        }
        this.scrollToEnd();
      },
      error: (error) => {
        this.turn = null;
        this.streaming.set(false);
        this.patchAnswer((answer) => ({ ...answer, streaming: false, activeTool: null, error: this.messageOf(error) }));
      },
      complete: () => {
        this.turn = null;
        this.streaming.set(false);
        this.patchAnswer((answer) => (answer.streaming ? { ...answer, streaming: false, activeTool: null } : answer));
      },
    });
  }

  private decide(proposal: CopilotProposal, decision: 'confirm' | 'reject'): void {
    if (this.deciding()) return;
    this.deciding.set(proposal.id);
    const call = decision === 'confirm' ? this.api.confirm(proposal.id) : this.api.reject(proposal.id);
    call.subscribe({
      next: (updated) => {
        this.proposals.update((map) => ({ ...map, [updated.id]: updated }));
        this.deciding.set(null);
      },
      error: (error) => {
        this.proposals.update((map) => ({ ...map, [proposal.id]: { ...proposal, error: this.messageOf(error) } }));
        this.deciding.set(null);
      },
    });
  }

  /** Apply `change` to the answer being written (the last assistant message). */
  private patchAnswer(change: (answer: PanelMessage) => PanelMessage): void {
    this.messages.update((list) => {
      const index = list.length - 1;
      if (index < 0 || list[index].role !== 'assistant') return list;
      const next = [...list];
      next[index] = change(list[index]);
      return next;
    });
  }

  private appendError(message: string): void {
    this.messages.update((list) => [...list, { key: `e-${Date.now()}`, role: 'assistant', text: '', toolsUsed: [], proposals: [], error: message }]);
  }

  private touchConversation(id: string, firstMessage: string): void {
    this.conversations.update((list) => {
      const current = list.find((item) => item.id === id);
      if (!current) return list;
      const updated = { ...current, title: current.title || firstMessage.slice(0, 80), updatedAt: new Date().toISOString() };
      return [updated, ...list.filter((item) => item.id !== id)];
    });
  }

  private fromEntry(entry: CopilotEntry): PanelMessage {
    return { key: `s-${entry.seq}`, role: entry.role, text: entry.text, toolsUsed: entry.toolsUsed, proposals: entry.proposals };
  }

  private scrollToEnd(): void {
    queueMicrotask(() => {
      const element = this.messagesEl()?.nativeElement;
      if (element) element.scrollTop = element.scrollHeight;
    });
  }

  private messageOf(error: unknown): string {
    if (error instanceof CopilotRequestError && error.message) return error.message;
    const body = (error as { error?: { message?: unknown; messageKey?: unknown } })?.error;
    if (typeof body?.message === 'string' && body.message) return body.message;
    if (typeof body?.messageKey === 'string') return this.translate.instant(body.messageKey);
    return this.translate.instant('ai.copilot.failed');
  }
}
