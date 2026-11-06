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
 * actions beside the title (`appSettingsActions`), whether the section saves on its own
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

  /**
   * Every form of the section that holds editable state. Usually one; a section built from several
   * panels (Artificial intelligence: the policy and the agents) registers each, and the shell asks
   * about, saves or drops them together, so one save bar and one question cover the whole page.
   */
  private readonly changes = signal<readonly SettingsChanges[]>([]);
  private readonly pending = computed(() => this.changes().filter((changes) => changes.dirty()));

  readonly dirty = computed(() => this.pending().length > 0);
  readonly canSave = computed(() => {
    const pending = this.pending();
    return pending.length > 0 && pending.every((changes) => Boolean(changes.save));
  });

  register(changes: SettingsChanges): void {
    this.changes.update((all) => (all.includes(changes) ? all : [...all, changes]));
  }

  unregister(changes: SettingsChanges): void {
    this.changes.update((all) => all.filter((item) => item !== changes));
  }

  /** A section that saves on its own reports each save here. */
  markAutosaved(): void {
    this.autosaves.set(true);
    this.autosavedAt.set(Date.now());
  }

  /** Saves every form with edits, one after another; true only when all of them reached the server. */
  async save(): Promise<boolean> {
    const pending = this.pending();
    if (!pending.length) return false;
    for (const changes of pending) {
      if (!changes.save || !(await changes.save())) return false;
    }
    return true;
  }

  discard(): void {
    for (const changes of this.pending()) changes.discard?.();
  }

  /** Forget everything about the section that is leaving. */
  reset(): void {
    this.actions.set(null);
    this.changes.set([]);
    this.autosavedAt.set(null);
    this.autosaves.set(false);
    this.canEdit.set(true);
  }
}
