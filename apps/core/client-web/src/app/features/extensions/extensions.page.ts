import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import {
  LucideAngularModule,
  Puzzle,
  Play,
  Trash2,
  ShieldCheck,
  RefreshCw,
  Loader,
} from 'lucide-angular';
import {
  ExecuteExtensionResult,
  ExtensionConsent,
  ExtensionSummary,
  ExtensionsService,
} from './extensions.service';

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
  imports: [CommonModule, RouterLink, ReactiveFormsModule, TranslateModule, LucideAngularModule],
  templateUrl: './extensions.page.html',
  styleUrls: ['./extensions.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExtensionsPage {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ExtensionsService);

  protected readonly PuzzleIcon = Puzzle;
  protected readonly PlayIcon = Play;
  protected readonly TrashIcon = Trash2;
  protected readonly ShieldIcon = ShieldCheck;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly LoaderIcon = Loader;

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

  toggleEnabled(ext: ExtensionSummary): void {
    const current = this.consentByPlugin().get(ext.name);
    this.service
      .setConsent(ext.name, { enabled: !(current?.enabled ?? false) })
      .subscribe({ next: () => this.refresh(), error: (err) => this.fail(err) });
  }

  grantAll(ext: ExtensionSummary, capabilities: string): void {
    this.service
      .setConsent(ext.name, { grantedCapabilities: this.parseList(capabilities), enabled: true })
      .subscribe({ next: () => this.refresh(), error: (err) => this.fail(err) });
  }

  revoke(ext: ExtensionSummary): void {
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
    const message =
      (err as { error?: { message?: string; reason?: string } })?.error?.message ??
      (err as { error?: { reason?: string } })?.error?.reason ??
      (err as { message?: string })?.message ??
      'Request failed';
    this.error.set(message);
  }
}
