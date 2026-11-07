import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { Bot } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { VxEmptyStateComponent, VxErrorStateComponent, VxSpinnerComponent } from '../../../shared/components/feedback';
import { SettingsGroupComponent } from '../../settings/shared';
import { McpGrant, McpService } from './mcp.service';

/**
 * The external AI agents this person connected (MCP), and the address to connect one. A group of
 * the settings window, with its anatomy: no card, the common empty and error states, and a
 * confirmation before an agent loses its access (ACC-04).
 */
@Component({
  selector: 'app-mcp-agents-panel',
  standalone: true,
  imports: [TranslatePipe, SettingsGroupComponent, VxEmptyStateComponent, VxErrorStateComponent, VxSpinnerComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (allowed) {
      <section class="mcp-agents">
        <vx-settings-group titleKey="ai.mcp.agents_title" descriptionKey="ai.mcp.agents_help">
          <div class="mcp-agents__endpoint">
            <span class="mcp-agents__label" id="mcp-endpoint-label">{{ 'ai.mcp.endpoint_label' | translate }}</span>
            <code aria-labelledby="mcp-endpoint-label">{{ endpoint }}</code>
            <button type="button" class="link-button" [attr.aria-label]="'ai.mcp.copy_endpoint' | translate" (click)="copy()">{{ 'inbound_mail.copy' | translate }}</button>
          </div>
          @switch (state()) {
            @case ('loading') {
              <vx-spinner withLabel labelKey="settings.sections.loading" />
            }
            @case ('error') {
              <vx-error-state [detail]="'ai.mcp.load_failed' | translate" (retry)="load()" />
            }
            @default {
              @if (grants().length) {
                <ul class="mcp-agents__list" role="list">
                  @for (grant of grants(); track grant.id) {
                    <li class="mcp-agents__item">
                      <div class="mcp-agents__info">
                        <p class="mcp-agents__name">{{ grant.client }}</p>
                        <p class="mcp-agents__meta">{{ (grant.scope.includes('erp:draft') ? 'ai.mcp.scope.draft' : 'ai.mcp.scope.read') | translate }}</p>
                        <p class="mcp-agents__meta">{{ 'ai.mcp.since' | translate: { date: (grant.since | vxDate: 'date') } }}</p>
                      </div>
                      <button type="button" class="secondary-button" [attr.aria-label]="'ai.mcp.disconnect_named' | translate: { client: grant.client }" (click)="revoke(grant)">
                        {{ 'ai.mcp.disconnect' | translate }}
                      </button>
                    </li>
                  }
                </ul>
              } @else {
                <vx-empty-state [icon]="BotIcon" titleKey="ai.mcp.no_agents_title" descriptionKey="ai.mcp.no_agents_description" />
              }
            }
          }
        </vx-settings-group>
      </section>
    }
  `,
  styles: [
    `
      @use 'app/features/settings/shared/settings-ui' as ui;

      :host { display: block; }
      .mcp-agents__endpoint { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2) var(--space-3); margin-block-end: var(--space-4); font-size: var(--text-sm); }
      .mcp-agents__label { color: var(--content-secondary); }
      .mcp-agents__endpoint code { font-family: var(--font-mono); color: var(--content-primary); overflow-wrap: anywhere; }
      .mcp-agents__list { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--border-subtle); }
      .mcp-agents__item { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) 0; border-bottom: 1px solid var(--border-subtle); }
      .mcp-agents__info { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
      .mcp-agents__name { margin: 0; font-size: var(--text-sm); font-weight: var(--font-semibold); color: var(--content-primary); }
      .mcp-agents__meta { margin: 0; font-size: var(--text-sm); color: var(--content-secondary); }
      .link-button { @include ui.link-button; }
    `,
  ],
})
export class McpAgentsPanelComponent implements OnInit {
  private readonly api = inject(McpService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  readonly allowed = inject(AuthService).hasPermissions(['ai_copilot:use']);
  readonly endpoint = this.api.endpoint;
  readonly grants = signal<McpGrant[]>([]);
  /** Read before anything is said: a failed read showed «No hay agentes conectados» (EST-02). */
  readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  protected readonly BotIcon = Bot;

  ngOnInit(): void {
    if (this.allowed) this.load();
  }

  load(): void {
    this.state.set('loading');
    this.api.grants().subscribe({
      next: (list) => {
        this.grants.set(list);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  copy(): void {
    void navigator.clipboard?.writeText(this.endpoint).then(() => this.notifications.showSuccess('ai.mcp.endpoint_copied'));
  }

  async revoke(grant: McpGrant): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'ai.mcp.disconnect_title',
      message: 'ai.mcp.disconnect_message',
      messageParams: { client: grant.client },
      confirmText: 'ai.mcp.disconnect',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.api.revoke(grant.id).subscribe({
      next: () => this.grants.update((list) => list.filter((item) => item.id !== grant.id)),
      error: (err) => this.notifications.showHttpError(err, 'ai.mcp.disconnect_failed'),
    });
  }
}
