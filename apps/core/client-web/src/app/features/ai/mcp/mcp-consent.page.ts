import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LucideAngularModule, ShieldCheck, TriangleAlert } from 'lucide-angular';
import { NotificationService } from '../../../core/services/notification';
import { McpConsentInfo, McpService } from './mcp.service';

const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state'] as const;

/**
 * An external AI agent asks to act in Virtex as the signed-in person, in the company they are in.
 * The page says which agent, where it will send them back, and what it may do — read, and propose
 * drafts that the person confirms here — and nothing is granted until they say yes.
 */
@Component({
  selector: 'app-mcp-consent-page',
  standalone: true,
  imports: [TranslatePipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mcp-consent card">
      @if (info(); as i) {
        <h1 class="mcp-consent__title">
          <lucide-icon [img]="ShieldIcon" size="20" aria-hidden="true"></lucide-icon>
          {{ 'ai.mcp.consent_title' | translate: { client: i.clientName } }}
        </h1>
        <p>{{ 'ai.mcp.consent_intro' | translate }}</p>
        <ul class="mcp-consent__scopes">
          @for (scope of i.scopes; track scope) {
            <li>{{ (scope === 'erp:draft' ? 'ai.mcp.scope.draft' : 'ai.mcp.scope.read') | translate }}</li>
          }
        </ul>
        <p class="mcp-consent__warning">
          <lucide-icon [img]="WarnIcon" size="14" aria-hidden="true"></lucide-icon>
          {{ 'ai.mcp.consent_return' | translate: { host: i.redirectHost } }}
        </p>
        <div class="mcp-consent__actions">
          <button type="button" class="primary-button" [disabled]="busy()" (click)="decide(true)">{{ 'ai.mcp.allow' | translate }}</button>
          <button type="button" class="secondary-button" [disabled]="busy()" (click)="decide(false)">{{ 'ai.mcp.deny' | translate }}</button>
        </div>
      } @else if (invalid()) {
        <p role="alert">{{ 'ai.mcp.invalid_request' | translate }}</p>
      } @else {
        <p>{{ 'reports.common.loading' | translate }}</p>
      }
    </section>
  `,
  styles: [
    `.mcp-consent { max-width: 36rem; margin: var(--space-6) auto; padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); }
     .mcp-consent__title { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: var(--text-lg); }
     .mcp-consent__scopes { margin: 0; padding-left: var(--space-5); }
     .mcp-consent__warning { display: flex; gap: var(--space-1); align-items: flex-start; font-size: var(--text-sm); color: var(--content-secondary); margin: 0; }
     .mcp-consent__actions { display: flex; gap: var(--space-2); }`,
  ],
})
export class McpConsentPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(McpService);
  private readonly notifications = inject(NotificationService);

  readonly info = signal<McpConsentInfo | null>(null);
  readonly invalid = signal(false);
  readonly busy = signal(false);
  protected readonly ShieldIcon = ShieldCheck;
  protected readonly WarnIcon = TriangleAlert;
  private params: Record<string, string> = {};

  ngOnInit(): void {
    const query = this.route.snapshot.queryParamMap;
    for (const key of PARAMS) {
      const value = query.get(key);
      if (value !== null) this.params[key] = value;
    }
    this.api.consentInfo(this.params).subscribe({ next: (info) => this.info.set(info), error: () => this.invalid.set(true) });
  }

  decide(approve: boolean): void {
    this.busy.set(true);
    this.api.consent(this.params, approve).subscribe({
      // Back to the agent, with its code (or the refusal). The address was checked against the
      // agent's registration on the server before it was ever offered here.
      next: ({ redirect }) => window.location.assign(redirect),
      error: (err) => {
        this.busy.set(false);
        this.notifications.showHttpError(err, 'ai.mcp.invalid_request');
      },
    });
  }
}
