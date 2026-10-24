import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { AuthService } from '../../../core/services/auth';
import { NotificationService } from '../../../core/services/notification';
import { McpGrant, McpService } from './mcp.service';

/** The external AI agents this person connected (MCP), and the address to connect one. */
@Component({
  selector: 'app-mcp-agents-panel',
  standalone: true,
  imports: [TranslatePipe, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (allowed) {
      <section class="card mcp-agents" aria-labelledby="mcp-agents-title">
        <h2 id="mcp-agents-title">{{ 'ai.mcp.agents_title' | translate }}</h2>
        <p>{{ 'ai.mcp.agents_help' | translate }}</p>
        <p><code>{{ endpoint }}</code></p>
        @if (grants().length) {
          <ul class="mcp-agents__list">
            @for (grant of grants(); track grant.id) {
              <li>
                <strong>{{ grant.client }}</strong>
                <span>{{ (grant.scope.includes('erp:draft') ? 'ai.mcp.scope.draft' : 'ai.mcp.scope.read') | translate }}</span>
                <span>{{ 'ai.mcp.since' | translate: { date: (grant.since | vxDate: 'date') } }}</span>
                <button type="button" class="secondary-button" (click)="revoke(grant)">{{ 'ai.mcp.disconnect' | translate }}</button>
              </li>
            }
          </ul>
        } @else {
          <p>{{ 'ai.mcp.no_agents' | translate }}</p>
        }
      </section>
    }
  `,
  styles: [
    `.mcp-agents { padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-4); }
     .mcp-agents h2 { margin: 0; font-size: var(--text-base); }
     .mcp-agents p { margin: 0; font-size: var(--text-sm); }
     .mcp-agents__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
     .mcp-agents__list li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }`,
  ],
})
export class McpAgentsPanelComponent implements OnInit {
  private readonly api = inject(McpService);
  private readonly notifications = inject(NotificationService);
  readonly allowed = inject(AuthService).hasPermissions(['ai_copilot:use']);
  readonly endpoint = this.api.endpoint;
  readonly grants = signal<McpGrant[]>([]);

  ngOnInit(): void {
    if (this.allowed) this.api.grants().subscribe({ next: (list) => this.grants.set(list), error: () => this.grants.set([]) });
  }

  revoke(grant: McpGrant): void {
    this.api.revoke(grant.id).subscribe({
      next: () => this.grants.update((list) => list.filter((item) => item.id !== grant.id)),
      error: (err) => this.notifications.showHttpError(err, 'ai.mcp.disconnect_failed'),
    });
  }
}
