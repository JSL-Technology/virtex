import { Injectable, Signal, TemplateRef, computed, signal } from '@angular/core';

/** What a section tells the shell about its unsaved work. */
export interface SettingsChanges {
  /** True while the section holds edits nobody saved. */
  dirty: Signal<boolean>;
  /** Saves them; resolves true when they reached the server. Absent: the section cannot be saved from outside. */
  save?: () => Promise<boolean>;
  /** Drops them. */
  discard?: () => void;
}

/**
 * The contract between the settings shell and the section it shows.
 *
 * ## Why a contract
 *
 * The 26 sections were 26 screens built apart, and the shell knew nothing about any of them: it
 * closed on Escape, on a click on the backdrop or on a change of section without asking, and every
 * edit in progress went with it. A section now *declares* its unsaved work here, and the shell
 * asks before anything throws it away — the same three-way question a document tab asks.
 *
 * It also carries what the shell draws for the section so that every section looks alike: the
 * actions beside the title (`vxSettingsActions`), whether the section saves on its own
 * (`autosaved`), and whether the person may change it at all (`canEdit`).
 *
 * Provided by the shell, so it is optional for a section: shown on its own (a test, a future
 * routed page) it simply finds nothing to talk to.
 */
@Injectable()
export class SettingsShellService {
  /** The actions the current section wants beside its title. */
  readonly actions = signal<TemplateRef<unknown> | null>(null);
  /** Whether the person may change the current section, from the registry's edit permission. */
  readonly canEdit = signal(true);
  /** Set by a section that saves each change as it is made: the moment of the last save. */
  readonly autosavedAt = signal<number | null>(null);
  /** True for a section that saves on its own, so the header says so before anything is saved. */
  readonly autosaves = signal(false);

  private readonly changes = signal<SettingsChanges | null>(null);

  readonly dirty = computed(() => this.changes()?.dirty() ?? false);
  readonly canSave = computed(() => Boolean(this.changes()?.save));

  register(changes: SettingsChanges): void {
    this.changes.set(changes);
  }

  unregister(changes: SettingsChanges): void {
    if (this.changes() === changes) this.changes.set(null);
  }

  /** A section that saves on its own reports each save here. */
  markAutosaved(): void {
    this.autosaves.set(true);
    this.autosavedAt.set(Date.now());
  }

  save(): Promise<boolean> {
    return this.changes()?.save?.() ?? Promise.resolve(false);
  }

  discard(): void {
    this.changes()?.discard?.();
  }

  /** Forget everything about the section that is leaving. */
  reset(): void {
    this.actions.set(null);
    this.changes.set(null);
    this.autosavedAt.set(null);
    this.autosaves.set(false);
    this.canEdit.set(true);
  }
}
