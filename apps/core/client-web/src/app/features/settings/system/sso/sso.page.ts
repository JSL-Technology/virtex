import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, forkJoin, of } from 'rxjs';
import { Ban, CircleCheck, Globe, KeyRound, LucideAngularModule, MoreHorizontal, Trash2 } from 'lucide-angular';
import {
  SsoAdminService,
  SsoDomain,
  SsoIdentityProvider,
} from '../../../../core/services/sso-admin.service';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxBadgeComponent } from '../../../../shared/components/badge';
import { NotificationService } from '../../../../core/services/notification';
import { DialogService } from '../../../../core/services/dialog.service';
import { VX_SORT, sortable } from '../../../../shared/components/sort';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../../shared/components/context-menu';
import { VxEmptyStateComponent, VxErrorStateComponent, VxNoticeComponent, VxSpinnerComponent } from '../../../../shared/components/feedback';
import { SettingsGroupComponent } from '../../shared';
import { SettingsShellService } from '../../shell';
import { Role, RolesService } from '../../data/roles.service';

/**
 * Per-organization enterprise SSO settings: manage verified email domains and OIDC identity
 * providers (Okta, Microsoft Entra, Google Workspace, Ping, Auth0, ...). A provider can only
 * be enabled once at least one domain is verified via the published DNS TXT record.
 */
@Component({
  selector: 'app-sso-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    LucideAngularModule,
    VxBadgeComponent,
    VxEmptyStateComponent,
    VxErrorStateComponent,
    VxNoticeComponent,
    VxSpinnerComponent,
    SettingsGroupComponent,
    ...VX_SORT,
    ...VX_CONTEXT_MENU,
    ...VX_FORM_A11Y,
  ],
  templateUrl: './sso.page.html',
  styleUrls: ['./sso.page.scss'],
})
export class SsoSettingsPage implements OnInit {
  /** Sortable by its headers (QA B-01). */
  readonly providersTable = sortable(() => this.providers());
  /** Sortable by its headers (QA B-01). */
  readonly domainsTable = sortable(() => this.domains());
  /** Turns the API's error contract (`code`, `messageKey`, `params`) into the reader's sentence. */
  private readonly errorText = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly api = inject(SsoAdminService);
  private readonly fb = inject(FormBuilder);
  private readonly dialog = inject(DialogService);
  private readonly rolesApi = inject(RolesService);
  private readonly shell = inject(SettingsShellService, { optional: true });

  protected readonly MoreIcon = MoreHorizontal;
  protected readonly GlobeIcon = Globe;
  protected readonly KeyIcon = KeyRound;

  /** Whether the person may change it; the window decides from the section's permission. */
  protected readonly canEdit = computed(() => this.shell?.canEdit() ?? true);

  domains = signal<SsoDomain[]>([]);
  providers = signal<SsoIdentityProvider[]>([]);
  /** The page reads its data before showing anything about it; a failure is said with a retry. */
  state = signal<'loading' | 'error' | 'ready'>('loading');
  loadError = signal<string | null>(null);
  /** The outcome of the last action, said once where the action was taken. */
  error = signal<string | null>(null);
  notice = signal<string | null>(null);
  /** «Agregar dominio» stays enabled; an empty field is said under it, not with a grey button (COMP-02). */
  domainError = signal<string | null>(null);
  /** The company's roles, to choose the default one by name; null when they cannot be read. */
  roles = signal<Role[] | null>(null);

  // Inline editing: the id of the provider currently being edited, or 'new', or null.
  editingProviderId = signal<string | null>(null);

  domainForm: FormGroup = this.fb.group({
    domain: ['', [Validators.required]],
  });

  providerForm: FormGroup = this.fb.group({
    name: ['', [Validators.required]],
    issuerUrl: ['', [Validators.required]],
    clientId: ['', [Validators.required]],
    clientSecret: [''],
    scopes: ['openid email profile'],
    defaultRoleId: [''],
  });

  /** Verify a pending domain in sight; delete in the shared row menu. */
  readonly domainsMenu: ListMenuConfig<SsoDomain> = {
    resource: 'sso_domains',
    row: (ctx) => {
      const domain = ctx.entity as SsoDomain;
      return [
        {
          id: 'danger',
          items: [{ id: 'delete', label: 'settings.sso.delete', icon: Trash2, danger: true, visible: () => this.canEdit(), run: () => this.deleteDomain(domain) }],
        },
      ];
    },
  };

  /** Edit in sight; switch on or off and delete in the shared row menu. */
  readonly providersMenu: ListMenuConfig<SsoIdentityProvider> = {
    resource: 'sso_providers',
    row: (ctx) => {
      const provider = ctx.entity as SsoIdentityProvider;
      const blocked = !provider.enabled && !this.hasVerifiedDomain();
      return [
        {
          id: 'state',
          items: [
            {
              id: 'toggle',
              // Disabled with its reason in the name itself, not a grey item that says nothing.
              label: provider.enabled ? 'common.deactivate' : blocked ? 'settings.sso.activate_needs_domain' : 'common.activate',
              icon: provider.enabled ? Ban : CircleCheck,
              visible: () => this.canEdit(),
              disabled: () => blocked,
              run: () => this.toggleEnabled(provider),
            },
          ],
        },
        {
          id: 'danger',
          items: [{ id: 'delete', label: 'settings.sso.delete', icon: Trash2, danger: true, visible: () => this.canEdit(), run: () => this.deleteProvider(provider) }],
        },
      ];
    },
  };

  ngOnInit(): void {
    this.refresh();
    this.rolesApi
      .getRoles()
      .pipe(catchError(() => of(null)))
      .subscribe((roles) => this.roles.set(roles && roles.length ? roles : null));
  }

  refresh(): void {
    if (this.state() !== 'ready') this.state.set('loading');
    this.loadError.set(null);
    forkJoin({ domains: this.api.listDomains(), providers: this.api.listProviders() }).subscribe({
      next: ({ domains, providers }) => {
        this.domains.set(domains);
        this.providers.set(providers);
        this.state.set('ready');
      },
      error: (e) => {
        this.loadError.set(this.errorText.httpErrorMessage(e, 'settings.sso.load_failed'));
        this.state.set('error');
      },
    });
  }

  // --- Domains ---

  addDomain(): void {
    if (this.domainForm.invalid) {
      this.domainError.set(this.translate.instant('settings.sso.domain_required'));
      return;
    }
    this.domainError.set(null);
    this.clearMessages();
    this.api.addDomain(String(this.domainForm.value.domain).trim()).subscribe({
      next: () => {
        this.domainForm.reset();
        this.notice.set(this.translate.instant('settings.sso.domain_added'));
        this.refresh();
      },
      error: (e) => this.error.set(this.errorText.httpErrorMessage(e, 'errors.add_domain')),
    });
  }

  verifyDomain(d: SsoDomain): void {
    this.clearMessages();
    this.api.verifyDomain(d.id).subscribe({
      next: () => {
        this.notice.set(this.translate.instant('settings.sso.domain_verified_notice', { domain: d.domain }));
        this.refresh();
      },
      error: (e) => this.error.set(this.errorText.httpErrorMessage(e, 'errors.verify_domain')),
    });
  }

  async deleteDomain(d: SsoDomain): Promise<void> {
    // Proportional confirmation: the domain's people stop going through the company's SSO (ACC-04).
    const confirmed = await this.dialog.confirm({
      title: 'settings.sso.delete_domain_title',
      message: 'settings.sso.delete_domain_message',
      messageParams: { domain: d.domain },
      confirmText: 'settings.sso.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.clearMessages();
    this.api.deleteDomain(d.id).subscribe({
      next: () => this.refresh(),
      error: (e) => this.error.set(this.errorText.httpErrorMessage(e, 'settings.sso.delete_domain_failed')),
    });
  }

  copy(value: string): void {
    navigator.clipboard?.writeText(value).then(
      () => this.notice.set(this.translate.instant('settings.sso.copied')),
      () => undefined,
    );
  }

  // --- Providers ---

  startNewProvider(): void {
    this.providerForm.reset({ scopes: 'openid email profile', defaultRoleId: '' });
    this.editingProviderId.set('new');
    this.clearMessages();
  }

  startEditProvider(p: SsoIdentityProvider): void {
    this.providerForm.reset({
      name: p.name,
      issuerUrl: p.issuerUrl,
      clientId: p.clientId,
      clientSecret: '', // never prefilled
      scopes: (p.scopes || []).join(' '),
      defaultRoleId: p.defaultRoleId || '',
    });
    this.editingProviderId.set(p.id);
    this.clearMessages();
  }

  cancelEdit(): void {
    this.editingProviderId.set(null);
  }

  saveProvider(): void {
    const editing = this.editingProviderId();
    if (!editing) return;
    if (this.providerForm.invalid) {
      this.providerForm.markAllAsTouched();
      return;
    }
    this.clearMessages();

    const raw = this.providerForm.value;
    const scopes = String(raw.scopes || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const base: any = {
      name: raw.name,
      issuerUrl: raw.issuerUrl,
      clientId: raw.clientId,
      scopes: scopes.length ? scopes : ['openid', 'email', 'profile'],
    };
    if (raw.clientSecret) base.clientSecret = raw.clientSecret;
    if (raw.defaultRoleId) base.defaultRoleId = raw.defaultRoleId;

    if (editing === 'new') {
      if (!raw.clientSecret) {
        this.error.set(this.translate.instant('settings.sso.secret_required'));
        return;
      }
      this.api.createProvider(base).subscribe({
        next: () => {
          this.editingProviderId.set(null);
          this.notice.set(this.translate.instant('settings.sso.provider_created'));
          this.refresh();
        },
        error: (e) => this.error.set(this.errorText.httpErrorMessage(e, 'errors.create_sso_provider')),
      });
    } else {
      this.api.updateProvider(editing, base).subscribe({
        next: () => {
          this.editingProviderId.set(null);
          this.notice.set(this.translate.instant('settings.sso.provider_updated'));
          this.refresh();
        },
        error: (e) => this.error.set(this.errorText.httpErrorMessage(e, 'errors.update_sso_provider')),
      });
    }
  }

  toggleEnabled(p: SsoIdentityProvider): void {
    if (!p.enabled && !this.hasVerifiedDomain()) return;
    this.clearMessages();
    this.api.updateProvider(p.id, { enabled: !p.enabled }).subscribe({
      next: () => this.refresh(),
      error: (e) => this.error.set(this.errorText.httpErrorMessage(e, 'errors.change_status')),
    });
  }

  async deleteProvider(p: SsoIdentityProvider): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'settings.sso.delete_provider_title',
      message: 'settings.sso.delete_provider_message',
      messageParams: { name: p.name },
      confirmText: 'settings.sso.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.clearMessages();
    this.api.deleteProvider(p.id).subscribe({
      next: () => this.refresh(),
      error: (e) => this.error.set(this.errorText.httpErrorMessage(e, 'settings.sso.delete_provider_failed')),
    });
  }

  hasVerifiedDomain(): boolean {
    return this.domains().some((d) => d.verified);
  }

  /** The default role by name; an id the list does not hold is shown as it is. */
  roleName(id: string | null | undefined): string {
    if (!id) return '';
    return this.roles()?.find((role) => role.id === id)?.name ?? id;
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }
}
