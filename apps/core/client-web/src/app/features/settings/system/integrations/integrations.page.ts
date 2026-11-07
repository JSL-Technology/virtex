import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { InboundMailboxesPanelComponent } from '../../../inbound-mail/inbound-mailboxes-panel.component';
import { McpAgentsPanelComponent } from '../../../ai/mcp/mcp-agents-panel.component';
import { SettingsGroupComponent } from '../../shared';
import { VxErrorStateComponent, VxSpinnerComponent } from '../../../../shared/components/feedback';

/**
 * The company's connections with other systems that are configured here and nowhere else: the
 * mail addresses suppliers and customers write to, the external AI agents connected over MCP, and
 * the way to bulk import and export data (QA M-09: «Integraciones y API» said «En desarrollo» and
 * listed API keys and webhooks that do not exist).
 *
 * It also showed cards for extensions, single sign-on and electronic invoicing, with their state
 * and a link. Each of those has its own page in the settings sidebar, so the cards were a second
 * way to the same place (ARQ-01), laid out as a grid of three and one left over (ANT-01). Their
 * state is on their own pages.
 */
@Component({
  selector: 'app-integration-settings-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, SettingsGroupComponent, InboundMailboxesPanelComponent, McpAgentsPanelComponent, VxErrorStateComponent, VxSpinnerComponent],
  templateUrl: './integrations.page.html',
  styleUrls: ['./integrations.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationSettingsPage {
  private readonly organization = inject(ActiveOrganizationService);

  /** Bulk import and export live in the application, not in settings: a link, not a copy. */
  readonly dataLink = this.organization.urlFor('/data-imports');

  private readonly inbound = viewChild(InboundMailboxesPanelComponent);
  private readonly agents = viewChild(McpAgentsPanelComponent);

  /** The panels this person sees; each reads its own data. */
  private readonly shown = computed(() => {
    const panels: (InboundMailboxesPanelComponent | McpAgentsPanelComponent)[] = [];
    const inbound = this.inbound();
    const agents = this.agents();
    if (inbound?.canManage()) panels.push(inbound);
    if (agents?.allowed) panels.push(agents);
    return panels;
  });

  /**
   * Every panel shown failed — a dropped connection. The page says so once, with one retry; two
   * identical errors, one per panel, said the same thing twice (CONT-02).
   */
  readonly allFailed = computed(() => {
    const panels = this.shown();
    return panels.length > 1 && panels.every((panel) => panel.state() === 'error');
  });

  /** Every panel shown still loading: one spinner for the page, not one per panel. */
  readonly allLoading = computed(() => {
    const panels = this.shown();
    return panels.length > 1 && panels.every((panel) => panel.state() === 'loading');
  });

  retryAll(): void {
    for (const panel of this.shown()) panel.load();
  }
}
