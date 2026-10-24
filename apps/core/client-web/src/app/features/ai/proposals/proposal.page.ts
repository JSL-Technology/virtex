import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LucideAngularModule, TriangleAlert } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { NotificationService } from '../../../core/services/notification';
import { CopilotApiService, CopilotProposal } from '../copilot/copilot-api.service';

/**
 * A draft proposed for the person — by an external agent over MCP, or in the assistant — to review
 * and confirm. Confirming creates it as a draft (never posted, never sent); the record says it was
 * proposed by an agent.
 */
@Component({
  selector: 'app-proposal-page',
  standalone: true,
  imports: [TranslatePipe, LucideAngularModule, RouterLink, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="proposal card">
      @if (proposal(); as p) {
        <h1 class="proposal__title">{{ k('ai.copilot.proposal', p.tool) | translate }}</h1>
        <p>{{ p.summary }}</p>
        @if (p.channel === 'MCP' || p.afterExternalText) {
          <p class="proposal__warning" role="note">
            <lucide-icon [img]="WarnIcon" size="14" aria-hidden="true"></lucide-icon>
            {{ (p.channel === 'MCP' ? 'ai.mcp.proposal_from_agent' : 'ai.copilot.after_external_text') | translate }}
          </p>
        }
        @if (lines(p).length) {
          <table class="data-table">
            <tbody>
              @for (line of lines(p); track $index) {
                <tr><td>{{ line.description }}</td><td class="text-right">{{ line.quantity | vxNumber }}</td><td class="text-right">{{ line.amount | vxMoney }}</td></tr>
              }
            </tbody>
          </table>
        }
        @if (p.preview['total'] !== undefined) {
          <p><strong>{{ 'ai.copilot.total' | translate }}:</strong> {{ $any(p.preview['total']) | vxMoney }}</p>
        }
        @switch (p.status) {
          @case ('PROPOSED') {
            <div class="proposal__actions">
              <button type="button" class="primary-button" [disabled]="busy()" (click)="decide('confirm')">{{ 'ai.copilot.confirm' | translate }}</button>
              <button type="button" class="secondary-button" [disabled]="busy()" (click)="decide('reject')">{{ 'ai.copilot.discard' | translate }}</button>
            </div>
          }
          @case ('CONFIRMED') {
            @if (p.result; as created) {
              <a [routerLink]="created.link">{{ 'ai.copilot.open_draft' | translate: { number: created.label } }}</a>
            }
          }
          @default {
            <p>{{ k('ai.copilot.proposal_status', p.status) | translate }}</p>
          }
        }
      } @else if (missing()) {
        <p role="alert">{{ 'ai.copilot.proposal_not_found' | translate }}</p>
      }
    </section>
  `,
  styles: [
    `.proposal { max-width: 44rem; margin: var(--space-6) auto; padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); }
     .proposal__title { margin: 0; font-size: var(--text-lg); }
     .proposal__warning { display: flex; gap: var(--space-1); color: var(--warning-text); font-size: var(--text-sm); margin: 0; }
     .proposal__actions { display: flex; gap: var(--space-2); }`,
  ],
})
export class ProposalPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CopilotApiService);
  private readonly notifications = inject(NotificationService);

  readonly proposal = signal<CopilotProposal | null>(null);
  readonly missing = signal(false);
  readonly busy = signal(false);
  protected readonly WarnIcon = TriangleAlert;
  protected readonly k = composeKey;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.api.proposal(id).subscribe({ next: (proposal) => this.proposal.set(proposal), error: () => this.missing.set(true) });
  }

  lines(proposal: CopilotProposal): Array<{ description: string; quantity: number; amount: number | null }> {
    const lines = proposal.preview['lines'];
    if (!Array.isArray(lines)) return [];
    return lines.map((line: Record<string, unknown>) => ({
      description: String(line['description'] ?? ''),
      quantity: Number(line['quantity'] ?? 0),
      amount: line['subtotal'] != null ? Number(line['subtotal']) : line['unitPrice'] != null ? Number(line['unitPrice']) * Number(line['quantity'] ?? 0) : null,
    }));
  }

  decide(decision: 'confirm' | 'reject'): void {
    const current = this.proposal();
    if (!current) return;
    this.busy.set(true);
    (decision === 'confirm' ? this.api.confirm(current.id) : this.api.reject(current.id)).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.proposal.set(updated);
      },
      error: (err) => {
        this.busy.set(false);
        this.notifications.showHttpError(err, 'ai.copilot.failed');
      },
    });
  }
}
