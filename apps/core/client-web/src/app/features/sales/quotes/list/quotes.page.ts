import { FormsModule } from '@angular/forms';
import { NavigationActionsService } from '../../../../core/navigation/navigation-actions.service';
import { DocumentIntentService } from '../../../../core/navigation/document-intent.service';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../../shared/components/context-menu';
import { VxBranchLabelComponent, VxBranchPickerComponent } from '../../../../shared/components/branch-picker';
import { BranchesService } from '../../../../core/tenancy/branches.service';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Ban, CheckCircle, Copy, FileText, LucideAngularModule, PlusCircle, RotateCw, Send, XCircle } from 'lucide-angular';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../../shared/components/badge';
import { CanOpenDirective } from '../../../../core/modules/can-open.directive';
import { NotificationService } from '../../../../core/services/notification';
import { Quote, QuoteStatus, QuotesService } from '../data/quotes.service';
import { RowLinkDirective } from '../../../../shared/directives/row-link.directive';
import { VX_SORT, sortable } from '../../../../shared/components/sort';
import { InboundMailInboxComponent } from '../../../inbound-mail/inbound-mail-inbox.component';

/** The colour each state carries. Expired overrides the stored state: it is what matters. */
export const QUOTE_TONE: Record<QuoteStatus, VxTone> = {
  DRAFT: 'draft',
  SENT: 'info',
  ACCEPTED: 'ok',
  REJECTED: 'danger',
  INVOICED: 'ok',
  CANCELLED: 'danger',
};

export const QUOTE_STATUSES: QuoteStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'INVOICED', 'CANCELLED'];

/**
 * Sales quotes (QA M-09: «Nueva cotización» led to «módulo en construcción»; the screens did not
 * exist). Filtered by state, because «what is waiting for the customer» and «what is ready to
 * invoice» are the two questions this list is opened to answer.
 */
@Component({
  selector: 'app-quotes-page',
  standalone: true,
  imports: [...VX_CONTEXT_MENU, InboundMailInboxComponent, ...VX_SORT, RowLinkDirective, CanOpenDirective, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, FormsModule, VxBranchPickerComponent, VxBranchLabelComponent],
  templateUrl: './quotes.page.html',
  styleUrls: ['./quotes.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuotesPage implements OnInit {
  private readonly menuIntents = inject(DocumentIntentService);
  private readonly menuNavigation = inject(NavigationActionsService);

  readonly quotesMenu: ListMenuConfig<Quote> = {
    resource: 'quotes',
    relationshipMapType: 'SALES_QUOTE',
    row: (ctx) => {
      const quote = ctx.entity as Quote;
      const path = `/quotes/${quote.id}/edit`;
      const ask = (action: string) => this.menuIntents.request(path, action);
      return [
        {
          id: 'document',
          items: [
            { id: 'mark-sent', label: 'sales.quotes.mark_sent', icon: Send, permission: 'invoices:create', visible: () => quote.status === 'DRAFT', run: () => ask('mark-sent') },
            { id: 'accept', label: 'sales.quotes.accept', icon: CheckCircle, permission: 'invoices:create', visible: () => ['DRAFT', 'SENT'].includes(quote.status), run: () => ask('accept') },
            { id: 'convert', label: 'sales.quotes.convert', icon: FileText, permission: 'invoices:create', visible: () => quote.status === 'ACCEPTED', run: () => ask('convert') },
            { id: 'duplicate', label: 'sales.quotes.duplicate', icon: Copy, permission: 'invoices:create', run: () => ask('duplicate') },
          ],
        },
        {
          id: 'corrections',
          items: [
            { id: 'reject', label: 'sales.quotes.reject', icon: XCircle, danger: true, permission: 'invoices:create', visible: () => ['DRAFT', 'SENT', 'ACCEPTED'].includes(quote.status), run: () => ask('reject') },
            { id: 'cancel', label: 'sales.quotes.cancel_quote', icon: Ban, danger: true, permission: 'invoices:create', visible: () => ['DRAFT', 'SENT'].includes(quote.status), run: () => ask('cancel') },
          ],
        },
        { id: 'list', items: [{ id: 'refresh', label: 'actions.refresh', icon: RotateCw, run: () => this.load() }] },
      ];
    },
  };

  private readonly translate = inject(TranslateService);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.rows(), { customer: (quote) => quote.customer?.companyName ?? quote.customer?.name, status: (quote) => this.translate.instant(this.statusKey(quote)) });
  private readonly quotes = inject(QuotesService);
  private readonly notifications = inject(NotificationService);

  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly statuses = QUOTE_STATUSES;

  readonly rows = signal<Quote[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filter = signal<QuoteStatus | null>(null);
  /** Empty: every branch the person may see. */
  readonly branchFilter = signal<string | null>(null);
  protected readonly branches = inject(BranchesService);
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.quotes.list(this.filter() ?? undefined, this.branchFilter()).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(this.notifications.httpErrorMessage(error, 'sales.quotes.load_failed'));
      },
    });
  }

  setBranch(branchId: string | null): void {
    this.branchFilter.set(branchId);
    this.load();
  }

  setFilter(status: QuoteStatus | null): void {
    this.filter.set(status);
    this.load();
  }

  tone(quote: Quote): VxTone {
    return quote.expired ? 'warning' : QUOTE_TONE[quote.status];
  }

  statusKey(quote: Quote): string {
    return quote.expired ? 'sales.quotes.status.expired' : `sales.quotes.status.${quote.status.toLowerCase()}`;
  }
}
