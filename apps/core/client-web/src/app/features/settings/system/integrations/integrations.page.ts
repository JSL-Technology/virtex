import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/services/auth';
import { SsoAdminService } from '../../../../core/services/sso-admin.service';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { ExtensionsService } from '../../../extensions/extensions.service';

/** The copy of each card. Literal keys, so the catalogue check sees every one of them. */
export const INTEGRATION_COPY = {
  extensions: {
    title: 'settings.integrations.extensions.title',
    description: 'settings.integrations.extensions.description',
    action: 'settings.integrations.extensions.action',
    status: {
      loading: 'settings.integrations.status_loading',
      active: 'settings.integrations.extensions.active',
      inactive: 'settings.integrations.extensions.inactive',
      unknown: 'settings.integrations.status_unknown',
    },
  },
  sso: {
    title: 'settings.integrations.sso.title',
    description: 'settings.integrations.sso.description',
    action: 'settings.integrations.sso.action',
    status: {
      loading: 'settings.integrations.status_loading',
      active: 'settings.integrations.sso.active',
      inactive: 'settings.integrations.sso.inactive',
      unknown: 'settings.integrations.status_unknown',
    },
  },
  einvoicing: {
    title: 'settings.integrations.einvoicing.title',
    description: 'settings.integrations.einvoicing.description',
    action: 'settings.integrations.einvoicing.action',
    status: {
      loading: 'settings.integrations.status_loading',
      active: 'settings.integrations.einvoicing.active',
      inactive: 'settings.integrations.einvoicing.inactive',
      unknown: 'settings.integrations.status_unknown',
    },
  },
  data: {
    title: 'settings.integrations.data.title',
    description: 'settings.integrations.data.description',
    action: 'settings.integrations.data.action',
    status: {
      loading: 'settings.integrations.status_loading',
      active: 'settings.integrations.data.active',
      inactive: 'settings.integrations.data.active',
      unknown: 'settings.integrations.status_unknown',
    },
  },
} as const;

export const STATE_LABELS = {
  loading: 'settings.integrations.state.loading',
  active: 'settings.integrations.state.active',
  inactive: 'settings.integrations.state.inactive',
  unknown: 'settings.integrations.state.unknown',
} as const;

/** What a card says about its integration: on, off, not readable by this user, or still loading. */
export type IntegrationState = 'loading' | 'active' | 'inactive' | 'unknown';

export interface IntegrationCard {
  id: 'extensions' | 'sso' | 'einvoicing' | 'data';
  state: IntegrationState;
  /** Parameters for the status line, e.g. how many extensions are enabled. */
  params: Record<string, unknown>;
  /** An application route (`link`) or a settings section (`fragment`). */
  link?: string;
  fragment?: string;
}

/**
 * The integrations the product actually has, with their live state (QA M-09: «Integraciones y
 * API» said «En desarrollo» and listed API keys and webhooks that do not exist).
 *
 * Each card reads its own source and links to where the integration is managed: signed
 * extensions and their per-tenant grants, single sign-on, the tax authority's electronic
 * invoicing, and bulk import/export. A card the user may not read says so instead of guessing.
 */
@Component({
  selector: 'app-integration-settings-page',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  templateUrl: './integrations.page.html',
  styleUrls: ['./integrations.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationSettingsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly extensions = inject(ExtensionsService);
  private readonly sso = inject(SsoAdminService);
  private readonly organization = inject(ActiveOrganizationService);

  readonly cards = signal<IntegrationCard[]>([
    { id: 'extensions', state: 'loading', params: {}, link: this.organization.urlFor('/extensions') },
    { id: 'sso', state: 'loading', params: {}, fragment: 'settings/sso' },
    { id: 'einvoicing', state: 'loading', params: {}, fragment: 'settings/fiscal' },
    { id: 'data', state: 'active', params: {}, link: this.organization.urlFor('/data-imports') },
  ]);

  ngOnInit(): void {
    this.read('extensions', 'extensions:view', () =>
      this.extensions.consents().pipe(
        map((consents) => {
          const enabled = consents.filter((consent) => consent.enabled).length;
          return { state: enabled > 0 ? 'active' : 'inactive', params: { enabled } } as const;
        }),
      ),
    );
    this.read('sso', 'settings:edit_company', () =>
      this.sso.listProviders().pipe(
        map((providers) => {
          const enabled = providers.filter((provider) => provider.enabled).length;
          return { state: enabled > 0 ? 'active' : 'inactive', params: { enabled } } as const;
        }),
      ),
    );
    this.read('einvoicing', 'taxes:view', () =>
      this.http
        .get<object | null>(`${environment.apiUrl}/einvoicing/regime/settings`)
        .pipe(map((settings) => ({ state: settings ? 'active' : 'inactive', params: {} }) as const)),
    );
  }

  protected readonly copy = INTEGRATION_COPY;
  protected readonly stateLabels = STATE_LABELS;

  statusKey(card: IntegrationCard): string {
    return INTEGRATION_COPY[card.id].status[card.state];
  }

  private read(
    id: IntegrationCard['id'],
    permission: string,
    source: () => Observable<{ state: IntegrationState; params: Record<string, unknown> }>,
  ): void {
    if (!this.auth.hasPermissions([permission])) {
      this.patch(id, { state: 'unknown' });
      return;
    }
    source()
      .pipe(catchError(() => of({ state: 'unknown' as const, params: {} })))
      .subscribe((result) => this.patch(id, result));
  }

  private patch(id: IntegrationCard['id'], patch: Partial<IntegrationCard>): void {
    this.cards.update((cards) => cards.map((card) => (card.id === id ? { ...card, ...patch } : card)));
  }
}
