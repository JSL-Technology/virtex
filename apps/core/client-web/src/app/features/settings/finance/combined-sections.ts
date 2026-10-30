import { Directive, DestroyRef, OnInit, computed, inject, input, signal, viewChildren } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { SettingsSectionComponent } from '../shared/settings-section.component';
import { SettingsChanges, SettingsShellService } from '../shell';

/**
 * A page that shows several settings sections and saves them as one: what the person changed
 * across the page is saved by one button, after one confirmation when an account changes.
 *
 * Shared by «Default accounts» and «Accounting and tax policies», which differ only in which half
 * of each section's declaration they show.
 */
@Directive()
export abstract class CombinedSettingsPage implements OnInit {
  protected readonly shell = inject(SettingsShellService, { optional: true });
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  /** The block an old link brings into view, e.g. `inventory`. */
  readonly focus = input<string | null>(null);

  protected readonly blocks = viewChildren(SettingsSectionComponent);
  protected readonly saving = signal(false);

  readonly dirty = computed(() => this.blocks().some((block) => block.dirty()));
  readonly canEdit = computed(() => this.shell?.canEdit() ?? true);

  private readonly changes: SettingsChanges = {
    dirty: this.dirty,
    save: () => this.save(),
    discard: () => this.discard(),
  };

  ngOnInit(): void {
    if (this.shell) {
      this.shell.register(this.changes);
      this.destroyRef.onDestroy(() => this.shell?.unregister(this.changes));
    }
  }

  async save(): Promise<boolean> {
    const changed = this.blocks().filter((block) => block.dirty());
    if (changed.length === 0) return true;
    const accounts = changed.filter((block) => block.changesAccounts()).length;
    if (accounts > 0) {
      const confirmed = await this.dialog.confirm({
        title: 'settings.sections.confirm_accounts_title',
        message: 'settings.sections.confirm_accounts_message',
        messageParams: { count: changed.reduce((total, block) => total + (block.changesAccounts() ? block.changeCount() : 0), 0) },
        confirmText: 'settings.shell.save',
        variant: 'warning',
      });
      if (!confirmed) return false;
    }
    this.saving.set(true);
    let ok = true;
    for (const block of changed) ok = (await block.save({ confirmed: true })) && ok;
    this.saving.set(false);
    if (ok) this.notifications.showSuccess('settings.sections.saved');
    return ok;
  }

  discard(): void {
    for (const block of this.blocks()) block.discard();
  }
}
