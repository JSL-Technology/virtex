import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, Check, X } from 'lucide-angular';
import { FORMAT_PIPES, FormatService } from '@virteex/shared/ui-i18n';
import { InboxShellComponent, InboxItem, InboxSection } from '../../shared/components/gestures';
import { NotificationService } from '../../core/services/notification';
import { DialogService } from '../../core/services/dialog.service';
import { ActiveOrganizationService } from '../../core/tenancy/active-organization.service';
import { ApprovalsInboxService, PendingDecision } from './data/approvals-inbox.service';
import { ModuleInboxService } from '../../core/inbox/module-inbox.service';
import { MODULES } from '../../core/modules/module-registry';

/**
 * The inbox: every document waiting on a decision, then the work each module has blocked.
 *
 * ## One inbox
 *
 * «Mi trabajo» was a second page showing the approvals this user could decide — the same rows as
 * here, under another name — plus each module's blocked work. That made two inboxes, and an inbox
 * exists to answer one question: «have I finished?». SAP's single «My Inbox» is the model. The
 * module sections moved here; `/my-work` redirects.
 *
 * ## Decisions (QA A-11)
 *
 *
 * It read only the workflow engine, so purchase orders and requisitions «por aprobar» never showed
 * and the page said there was nothing pending. It now reads the approvals inbox — every source the
 * user may decide on — and each item links to its document, so it can be read before deciding.
 * An item the user cannot decide (they raised it, or the step belongs to another role) is shown
 * with the reason instead of buttons: hiding it would hide that it is stuck.
 */
@Component({
  selector: 'app-approvals-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, InboxShellComponent, ...FORMAT_PIPES],
  templateUrl: './approvals.page.html',
  styleUrls: ['./approvals.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalsPage implements OnInit {
  private readonly inbox = inject(ApprovalsInboxService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly moduleInbox = inject(ModuleInboxService);

  protected readonly ApproveIcon = Check;
  protected readonly RejectIcon = X;

  readonly pending = signal<PendingDecision[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly deciding = signal<string | null>(null);

  private readonly byKey = computed(() => new Map(this.pending().map((d) => [keyOf(d), d])));

  /**
   * Decisions first — they block another person — then one section per module with blocked work.
   * Each module sends its items already ordered by how long they have waited, and the server orders
   * the modules the same way, so the inbox reads top to bottom without comparing anything.
   */
  readonly sections = computed<InboxSection[]>(() => [...this.decisionSections(), ...this.moduleSections()]);

  private readonly decisionSections = computed<InboxSection[]>(() => {
    const byType = new Map<string, InboxItem[]>();
    for (const decision of this.pending()) {
      const items = byType.get(decision.documentTypeKey) ?? [];
      items.push(this.toItem(decision));
      byType.set(decision.documentTypeKey, items);
    }
    if (byType.size === 0) return [{ labelKey: 'approvals.waiting_your_decision', items: [] }];
    return [...byType.entries()].map(([labelKey, items]) => ({ labelKey, items }));
  });

  private readonly moduleSections = computed<InboxSection[]>(() =>
    this.moduleInbox.modules().map((module) => ({
      labelKey: MODULES.find((m) => m.id === module.moduleId)?.titleKey ?? module.moduleId,
      //  The inbox shell takes composed text, not keys: the module sends the key and its parameters
      //  and the sentence is resolved here, once, in the reader's language.
      items: module.items.map((item) => ({
        id: `${module.moduleId}:${item.id}`,
        title: this.translate.instant(item.titleKey, item.titleParams),
        when: this.translate.instant('inbox.blocked_since', { date: item.blockedSince.slice(0, 10) }),
        link: this.tenancy.urlFor(item.route),
      })),
    })),
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    // Asked for here rather than by the shell: whoever opens the inbox wants the count of now, and
    // the module rail updates from the same answer because both read the same service.
    void this.moduleInbox.refresh();
    this.inbox.pending().subscribe({
      next: (decisions) => {
        this.pending.set(decisions);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'approvals.load_failed'));
        this.loading.set(false);
      },
    });
  }

  decisionOf(itemId: string): PendingDecision | undefined {
    return this.byKey().get(itemId);
  }

  approve(itemId: string): void {
    const decision = this.decisionOf(itemId);
    if (!decision) return;
    this.decide(this.inbox.approve(decision), itemId, 'approvals.request_approved');
  }

  async reject(itemId: string): Promise<void> {
    const decision = this.decisionOf(itemId);
    if (!decision) return;
    const reason = await this.dialog.prompt({
      title: 'approvals.reason_rejection',
      message: 'approvals.rejection_with_no_reason_not_decision',
      confirmText: 'approvals.reject',
      variant: 'danger',
      minLength: 3,
    });
    if (reason === null) return;
    this.decide(this.inbox.reject(decision, reason), itemId, 'approvals.request_rejected');
  }

  private decide(request: ReturnType<ApprovalsInboxService['approve']>, itemId: string, successKey: string): void {
    this.deciding.set(itemId);
    request.subscribe({
      next: () => {
        this.notifications.showSuccess(successKey);
        this.deciding.set(null);
        // Reloaded rather than removed by hand: an approval may advance a workflow to its next
        // step instead of closing it, and only the server knows which.
        this.load();
      },
      error: (err: unknown) => {
        this.notifications.showHttpError(err, 'approvals.decision_could_not_recorded');
        this.deciding.set(null);
      },
    });
  }

  private toItem(decision: PendingDecision): InboxItem {
    const title = this.translate.instant(decision.documentTypeKey);
    const detail = [
      decision.number,
      decision.party,
      decision.step !== null ? this.translate.instant('approvals.step_step', { step: decision.step }) : null,
    ]
      .filter((part) => !!part)
      .join(' · ');
    return {
      id: keyOf(decision),
      title,
      detail,
      amount: decision.amount === null ? undefined : this.format.money(decision.amount, decision.currencyCode),
      when: decision.requestedAt ? this.format.date(decision.requestedAt) : undefined,
      link: decision.route ? this.tenancy.urlFor(decision.route) : null,
    };
  }
}

function keyOf(decision: Pick<PendingDecision, 'source' | 'id'>): string {
  return `${decision.source}:${decision.id}`;
}
