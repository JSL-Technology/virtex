import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Mail, PhoneCall, RefreshCw, Sparkles, X } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { composeKey } from '@virteex/shared/types';
import { NotificationService } from '../../../core/services/notification';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { ListShellComponent } from '../../../shared/components/gestures';
import {
  CallOutcome,
  CollectionAction,
  CollectionActivity,
  CollectionsApiService,
  CollectionsWorklist,
  CollectionsWorklistItem,
  ReminderTone,
} from './collections.service';

/** The filters offered, in the order a collector works through them. */
const ACTIONS: CollectionAction[] = ['call', 'firm_reminder', 'reminder', 'courtesy_reminder', 'await_promise', 'wait'];

/**
 * Sales › Collections.
 *
 * Every open invoice the person may see, ranked by who to chase first — the balance, how overdue
 * it is, how likely it is to arrive without anyone doing anything (from the cash-flow projection,
 * when there is one), and what was already done: a promise broken moves it up, a promise in date
 * or a reminder sent yesterday moves it down. Each row says what to do next and why.
 *
 * Opening a row is where the work happens: write the reminder (or have the assistant draft it in
 * the tone the row suggests, from the invoice's own figures), keep it as a draft or send it with
 * the invoice attached; record a call, a promise or a note; see everything done before. Nothing is
 * sent without the person pressing Send.
 */
@Component({
  selector: 'app-collections-page',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, HasPermissionDirective, VxBadgeComponent, ListShellComponent],
  templateUrl: './collections.page.html',
  styleUrl: './collections.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionsPage implements OnInit {
  private readonly api = inject(CollectionsApiService);
  private readonly notifications = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);

  protected readonly RefreshIcon = RefreshCw;
  protected readonly AiIcon = Sparkles;
  protected readonly SendIcon = Mail;
  protected readonly CallIcon = PhoneCall;
  protected readonly CloseIcon = X;
  protected readonly k = composeKey;
  protected readonly actions = ACTIONS;
  protected readonly tones: ReminderTone[] = ['cordial', 'formal', 'firm'];
  protected readonly outcomes: CallOutcome[] = ['reached', 'no_answer', 'promised', 'disputed', 'wrong_contact', 'paid_already'];

  readonly worklist = signal<CollectionsWorklist | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filter = signal<CollectionAction | null>(null);

  /** The invoice being worked on, and its history. */
  readonly selected = signal<CollectionsWorklistItem | null>(null);
  readonly activities = signal<CollectionActivity[]>([]);

  // The reminder being written.
  readonly tone = signal<ReminderTone>('formal');
  readonly message = signal('');
  readonly to = signal('');
  readonly draftId = signal<string | null>(null);
  readonly composing = signal(false);
  readonly sending = signal(false);

  // The activity being recorded.
  readonly logKind = signal<'CALL' | 'PROMISE' | 'NOTE'>('CALL');
  readonly logOutcome = signal<CallOutcome | ''>('');
  readonly logDate = signal('');
  readonly logAmount = signal<number | null>(null);
  readonly logNote = signal('');
  readonly logging = signal(false);

  readonly currency = computed(() => this.worklist()?.baseCurrency ?? null);
  readonly items = computed(() => this.worklist()?.items ?? []);
  readonly byAction = computed(() => this.worklist()?.totals.byAction ?? {});
  /** A call that ends in a promise, or a promise: both need the date. */
  readonly needsDate = computed(() => this.logKind() === 'PROMISE' || (this.logKind() === 'CALL' && this.logOutcome() === 'promised'));

  /** A draft named in the link (from the assistant): opened as soon as its row is on the list. */
  private pendingDraftId: string | null = null;

  ngOnInit(): void {
    this.pendingDraftId = this.route.snapshot.queryParamMap.get('draft');
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.worklist({ action: this.filter(), limit: 200 }).subscribe({
      next: (list) => {
        this.worklist.set(list);
        this.loading.set(false);
        const current = this.selected();
        const reopen =
          (this.pendingDraftId && list.items.find((item) => item.draftReminderId === this.pendingDraftId)) ||
          (current && list.items.find((item) => item.invoiceId === current.invoiceId));
        this.pendingDraftId = null;
        if (reopen) this.open(reopen);
        else if (current) this.close();
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(this.notifications.httpErrorMessage(error, 'errors.unexpected'));
      },
    });
  }

  setFilter(action: CollectionAction | null): void {
    this.filter.set(this.filter() === action ? null : action);
    this.load();
  }

  open(item: CollectionsWorklistItem): void {
    const switching = this.selected()?.invoiceId !== item.invoiceId;
    this.selected.set(item);
    if (switching) {
      this.tone.set(item.suggestedTone ?? 'formal');
      this.message.set('');
      this.to.set(item.email ?? '');
      this.draftId.set(null);
      this.resetLog();
    }
    this.api.activities(item.invoiceId).subscribe({
      next: (activities) => {
        this.activities.set(activities.filter((activity) => activity.status !== 'CANCELLED'));
        // An open draft (the assistant's, or one kept earlier) is what the reminder starts from.
        const draft = activities.find((activity) => activity.status === 'DRAFT' && activity.kind === 'REMINDER');
        if (draft && switching) {
          this.draftId.set(draft.id);
          this.message.set(draft.message ?? '');
          if (draft.tone) this.tone.set(draft.tone);
          if (draft.recipient) this.to.set(draft.recipient);
        }
      },
      error: () => this.activities.set([]),
    });
  }

  close(): void {
    this.selected.set(null);
    this.activities.set([]);
  }

  compose(): void {
    const item = this.selected();
    if (!item) return;
    this.composing.set(true);
    this.api.compose(item.invoiceId, this.tone()).subscribe({
      next: ({ message }) => {
        this.composing.set(false);
        this.message.set(message);
      },
      error: (error) => {
        this.composing.set(false);
        this.notifications.showHttpError(error, 'collections.compose_failed');
      },
    });
  }

  saveDraft(): void {
    const item = this.selected();
    if (!item) return;
    this.api.saveDraft(item.invoiceId, { tone: this.tone(), message: this.message() || undefined, to: this.to() || undefined }).subscribe({
      next: (draft) => {
        this.draftId.set(draft.id);
        this.notifications.showSuccess('collections.draft_saved');
        this.load();
      },
      error: (error) => this.notifications.showHttpError(error, 'errors.unexpected'),
    });
  }

  send(): void {
    const item = this.selected();
    if (!item) return;
    this.sending.set(true);
    this.api
      .send(item.invoiceId, {
        tone: this.tone(),
        message: this.message() || undefined,
        to: this.to() || undefined,
        draftId: this.draftId() ?? undefined,
      })
      .subscribe({
        next: ({ to }) => {
          this.sending.set(false);
          this.draftId.set(null);
          this.message.set('');
          this.notifications.showSuccess('collections.reminder_sent', { to });
          this.load();
        },
        error: (error) => {
          this.sending.set(false);
          this.notifications.showHttpError(error, 'errors.unexpected');
        },
      });
  }

  discardDraft(): void {
    const id = this.draftId();
    if (!id) return;
    this.api.cancelDraft(id).subscribe({
      next: () => {
        this.draftId.set(null);
        this.message.set('');
        this.load();
      },
      error: (error) => this.notifications.showHttpError(error, 'errors.unexpected'),
    });
  }

  record(): void {
    const item = this.selected();
    if (!item) return;
    if (this.needsDate() && !this.logDate()) {
      this.notifications.showError('collections.promise_needs_date');
      return;
    }
    if (this.logKind() === 'NOTE' && !this.logNote().trim()) return;
    this.logging.set(true);
    this.api
      .log({
        invoiceId: item.invoiceId,
        kind: this.logKind(),
        outcome: this.logKind() === 'CALL' && this.logOutcome() ? (this.logOutcome() as CallOutcome) : undefined,
        promisedDate: this.needsDate() ? this.logDate() : undefined,
        promisedAmount: this.needsDate() && this.logAmount() ? Number(this.logAmount()) : undefined,
        message: this.logNote().trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.logging.set(false);
          this.resetLog();
          this.notifications.showSuccess('collections.activity_recorded');
          this.load();
        },
        error: (error) => {
          this.logging.set(false);
          this.notifications.showHttpError(error, 'errors.unexpected');
        },
      });
  }

  actionTone(action: CollectionAction): VxTone {
    if (action === 'call') return 'danger';
    if (action === 'firm_reminder') return 'warning';
    if (action === 'reminder' || action === 'courtesy_reminder') return 'info';
    return 'neutral';
  }

  private resetLog(): void {
    this.logKind.set('CALL');
    this.logOutcome.set('');
    this.logDate.set('');
    this.logAmount.set(null);
    this.logNote.set('');
  }
}
