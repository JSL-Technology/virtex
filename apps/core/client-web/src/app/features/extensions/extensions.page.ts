import { AuthService } from '../../core/services/auth';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { composeKey } from '@virteex/shared/types';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import {
  LucideAngularModule,
  Puzzle,
  Play,
  Trash2,
  ShieldCheck,
  RefreshCw,
  Loader,
  MoreHorizontal,
} from 'lucide-angular';
import { ListShellComponent } from '../../shared/components/gestures';
import {
  ExecuteExtensionResult,
  ExtensionConsent,
  ExtensionSummary,
  ExtensionsService,
} from './extensions.service';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { NotificationService } from '../../core/services/notification';
import { VX_SORT, sortable } from '../../shared/components/sort';
import { DialogService } from '../../core/services/dialog.service';
import { ActiveOrganizationService } from '../../core/tenancy/active-organization.service';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../shared/components/context-menu';
import { VxBadgeComponent } from '../../shared/components/badge';
import { VxEmptyStateComponent, VxErrorStateComponent, VxSpinnerComponent } from '../../shared/components/feedback';
import { SettingsActionsDirective, SettingsShellService } from '../settings/shell';

/**
 * The extensions manager: install signed extensions into the tenant, grant them capabilities, run
 * them in the sandbox, and see the result.
 *
 * A deliberately consolidated single page rather than a wizard — installing, consenting and running
 * are the whole loop an operator does when trying an extension, and keeping them on one screen makes
 * the consent gate (capabilities requested vs granted) visible at the moment it matters.
 */
@Component({
  selector: 'app-extensions-page',
  standalone: true,
  imports: [...VX_SORT, 
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    TranslateModule,
    LucideAngularModule,
    ListShellComponent,
    SettingsActionsDirective,
    VxBadgeComponent,
    VxEmptyStateComponent,
    VxErrorStateComponent,
    VxSpinnerComponent,
    ...VX_CONTEXT_MENU,
    ...VX_FORM_A11Y,
  ],
  templateUrl: './extensions.page.html',
  styleUrls: ['./extensions.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExtensionsPage {
  /** Opened as a section of Settings, which draws the heading. */
  readonly embedded = input(false);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.extensions());
  /** Turns the API's error contract (`code`, `messageKey`, `params`) into the reader's sentence. */
  private readonly errorText = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ExtensionsService);

  protected readonly PuzzleIcon = Puzzle;
  protected readonly PlayIcon = Play;
  protected readonly TrashIcon = Trash2;
  protected readonly ShieldIcon = ShieldCheck;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly LoaderIcon = Loader;
  protected readonly MoreIcon = MoreHorizontal;
  protected readonly k = composeKey;

  private readonly dialog = inject(DialogService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly shell = inject(SettingsShellService, { optional: true });
  /** The full manager, where extensions are registered and tried in the sandbox. */
  readonly managerLink = this.organization.urlFor('/extensions');
  /** Enabling and disabling take `extensions:manage`; in Settings the window decides from it. */
  readonly canManage = computed(() => this.shell?.canEdit() ?? true);
  /** The list was read at least once: a refresh keeps the table in place instead of a spinner. */
  readonly loaded = signal(false);

  /** Revoking is the platform's, and destructive: in the row's menu, asked first. */
  readonly extensionsMenu: ListMenuConfig<ExtensionSummary> = {
    resource: 'extensions',
    row: (ctx) => {
      const ext = ctx.entity as ExtensionSummary;
      return [
        {
          id: 'danger',
          items: [{ id: 'revoke', label: 'extensions.revoke', icon: Trash2, danger: true, visible: () => this.canRevoke(), run: () => this.revoke(ext) }],
        },
      ];
    },
  };

  private readonly auth = inject(AuthService);
  readonly extensions = signal<ExtensionSummary[]>([]);
  readonly consents = signal<ExtensionConsent[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<ExecuteExtensionResult | null>(null);

  readonly consentByPlugin = computed(() => {
    const map = new Map<string, ExtensionConsent>();
    for (const c of this.consents()) map.set(c.plugin, c);
    return map;
  });

  /**
   * Publishing and revoking act on the catalogue every tenant shares, and need a PLATFORM right
   * that no tenant role grants — `'*'` does not satisfy it. The form was shown to a tenant
   * administrator, who re-entered their password to submit it and then got 403 (QA M-13).
   * Exact strings, matching the server's `hasPlatformPermission`.
   */
  private readonly platformPermissions = computed(() => new Set(this.auth.currentUser()?.permissions ?? []));
  readonly canPublish = computed(() => this.platformPermissions().has('platform:extensions:publish'));
  readonly canRevoke = computed(() => this.platformPermissions().has('platform:extensions:revoke'));

  readonly registerForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    version: ['1.0.0', [Validators.required]],
    description: [''],
    capabilities: [''],
    requestedEgress: [''],
    code: ['log("Hello from the extension sandbox");', [Validators.required]],
    // Optional client-side UI (JavaScript). Runs in a sandboxed iframe via the extension runtime.
    uiEntry: [''],
  });

  readonly executeForm = this.fb.group({
    pluginName: ['', [Validators.required]],
  });

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: (list) => {
        this.extensions.set(list);
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: (err) => this.fail(err),
    });
    this.service.consents().subscribe({
      next: (c) => this.consents.set(c),
      error: () => void 0,
    });
  }

  private parseList(value: string | null | undefined): string[] {
    return (value ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  register(): void {
    if (this.registerForm.invalid) return;
    const v = this.registerForm.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    const uiEntry = (v.uiEntry ?? '').trim() || undefined;
    this.service
      .register({
        name: v.name!,
        version: v.version!,
        description: v.description || undefined,
        capabilities: this.parseList(v.capabilities),
        requestedEgress: this.parseList(v.requestedEgress),
        code: v.code!,
        uiEntry,
        // A UI extension contributes a page by default; the runtime reads this to mount it.
        contributes: uiEntry ? { points: [{ type: 'page' }] } : undefined,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.refresh();
        },
        error: (err) => this.fail(err),
      });
  }

  isEnabled(ext: ExtensionSummary): boolean {
    return this.consentByPlugin().get(ext.name)?.enabled ?? false;
  }

  /**
   * Switching an extension on lets its code run with the capabilities granted to it, for the whole
   * company: asked first, naming what it may use (ACC-04). Switching it off is never asked.
   */
  async toggleEnabled(ext: ExtensionSummary): Promise<void> {
    if (!this.canManage()) return;
    const enabling = !this.isEnabled(ext);
    if (enabling) {
      const capabilities = this.consentByPlugin().get(ext.name)?.grantedCapabilities ?? [];
      const confirmed = await this.dialog.confirm({
        title: 'extensions.enable_title',
        message: capabilities.length ? 'extensions.enable_message' : 'extensions.enable_message_none',
        messageParams: { name: ext.name, capabilities: capabilities.join(', ') },
        confirmText: 'common.activate',
        variant: 'warning',
      });
      if (!confirmed) return;
    }
    this.service
      .setConsent(ext.name, { enabled: enabling })
      .subscribe({ next: () => this.refresh(), error: (err) => this.fail(err) });
  }

  grantAll(ext: ExtensionSummary, capabilities: string): void {
    this.service
      .setConsent(ext.name, { grantedCapabilities: this.parseList(capabilities), enabled: true })
      .subscribe({ next: () => this.refresh(), error: (err) => this.fail(err) });
  }

  async revoke(ext: ExtensionSummary): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'extensions.revoke_title',
      message: 'extensions.revoke_message',
      messageParams: { name: ext.name },
      confirmText: 'extensions.revoke',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.service.revoke(ext.name).subscribe({
      next: () => this.refresh(),
      error: (err) => this.fail(err),
    });
  }

  execute(): void {
    if (this.executeForm.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    this.service.execute({ pluginName: this.executeForm.getRawValue().pluginName! }).subscribe({
      next: (res) => {
        this.result.set(res);
        this.busy.set(false);
      },
      error: (err) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.loading.set(false);
    this.busy.set(false);
    // The API's contract has `messageKey`, not `message`; this showed the literal English
    // "Request failed" for every refusal, whatever the language and whatever the reason.
    this.error.set(this.errorText.httpErrorMessage(err, 'errors.unexpected'));
  }
}
