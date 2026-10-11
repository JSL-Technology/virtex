import { Injectable, computed, inject, signal } from '@angular/core';
import { PlatformService } from '../platform/platform.service';
import {
  KeyChord,
  ShortcutDefinition,
  ShortcutGroupMeta,
  ShortcutId,
  SHORTCUT_DEFINITIONS,
  SHORTCUT_GROUPS,
  chordsEqual,
  hasModifier,
  matchesChord,
} from './keyboard-shortcuts';

/** One shortcut, resolved to the binding currently in effect, for display and editing. */
export interface ShortcutView {
  id: ShortcutId;
  descriptionKey: string;
  editable: boolean;
  route?: string;
  /** The chord(s) in effect — the override if the user set one, else the factory default(s). */
  chords: KeyChord[];
  /** True when a user override is in effect, so the UI can offer "reset to default". */
  customized: boolean;
}

export interface ShortcutGroupView extends ShortcutGroupMeta {
  shortcuts: ShortcutView[];
}

/** A named keymap the reader can switch to from "Use shortcuts from other apps". */
export interface ShortcutPreset {
  id: string;
  labelKey: string;
  /** Overrides this preset applies on top of the factory defaults. Empty = pure defaults. */
  bindings: Partial<Record<ShortcutId, KeyChord>>;
}

/**
 * The reason a candidate binding was refused, for the editor to show inline.
 * `null` means the binding is accepted.
 */
export type BindingRejection =
  | { reason: 'needs_modifier' }
  | { reason: 'conflict'; withDescriptionKey: string };

const STORAGE_KEY = 'virtex.keyboard-shortcuts.v1';

/**
 * The presets offered in the dialog's "Use shortcuts from other apps" selector.
 *
 * Only the factory map ships today; the structure is what matters — a preset is DATA, so a second
 * keymap is a new entry here and nothing else. Inventing bindings we do not actually honour would
 * be worse than offering one honest default, which is why there is exactly one for now.
 */
export const SHORTCUT_PRESETS: readonly ShortcutPreset[] = [
  { id: 'default', labelKey: 'main.shortcuts.preset_default', bindings: {} },
];

/**
 * The single source of truth for which keys do what — and the one place that can change it.
 *
 * ## Why a service and not the static registry alone
 *
 * Because the shortcuts are now editable. {@link SHORTCUT_DEFINITIONS} holds the factory defaults;
 * this service overlays the reader's own bindings (persisted in `localStorage`) and exposes the
 * EFFECTIVE binding per shortcut. The handlers — quick-create in the shell, the tab service, the
 * tab context menu — all match against what this service reports, so a rebind in the dialog takes
 * effect everywhere at once with nothing else to update. That is the difference between editing
 * that works and a settings screen that only looks like it does.
 */
@Injectable({ providedIn: 'root' })
export class ShortcutsService {
  private readonly platform = inject(PlatformService);

  /** User overrides by id. The whole customisation state; everything else derives from it. */
  private readonly overrides = signal<Partial<Record<ShortcutId, KeyChord>>>(this.load());

  /** Set true while the editor is capturing keys, so global handlers stand down and don't fire. */
  readonly capturing = signal(false);

  readonly presets = SHORTCUT_PRESETS;

  /** Every shortcut resolved to its effective binding, grouped in display order. */
  readonly groups = computed<ShortcutGroupView[]>(() => {
    const overrides = this.overrides();
    return SHORTCUT_GROUPS.map((group) => ({
      ...group,
      shortcuts: SHORTCUT_DEFINITIONS.filter((def) => def.groupId === group.id).map((def) =>
        this.viewFor(def, overrides),
      ),
    }));
  });

  /** The create shortcuts, for the quick-create menu and its handler. */
  readonly createShortcuts = computed<ShortcutView[]>(() => {
    const overrides = this.overrides();
    return SHORTCUT_DEFINITIONS.filter((def) => def.groupId === 'create').map((def) =>
      this.viewFor(def, overrides),
    );
  });

  /** The create shortcuts as menu rows — route guaranteed, a single chord to show. */
  readonly createMenu = computed(() =>
    this.createShortcuts()
      .filter((view) => view.route)
      .map((view) => ({ route: view.route as string, descriptionKey: view.descriptionKey, chord: view.chords[0] })),
  );

  /** The chord(s) currently bound to a shortcut. */
  effectiveChords(id: ShortcutId): KeyChord[] {
    const override = this.overrides()[id];
    if (override) return [override];
    return this.definition(id).defaults;
  }

  /** The first chord bound to a shortcut — what a single chip shows (e.g. the context menu). */
  primaryChord(id: ShortcutId): KeyChord {
    return this.effectiveChords(id)[0];
  }

  /** Whether a keydown invokes a given shortcut, under the current platform. */
  matches(event: KeyboardEvent, id: ShortcutId): boolean {
    const isMac = this.platform.isMac();
    return this.effectiveChords(id).some((chord) => matchesChord(event, chord, isMac));
  }

  /** The create shortcut a keydown invokes, if any — the shell's handler navigates to its route. */
  matchCreate(event: KeyboardEvent): ShortcutView | null {
    const isMac = this.platform.isMac();
    return (
      this.createShortcuts().find((view) =>
        view.chords.some((chord) => matchesChord(event, chord, isMac)),
      ) ?? null
    );
  }

  /**
   * Why a candidate chord would be refused for a shortcut, WITHOUT saving it — so the editor can
   * warn as the reader types. `null` means it is acceptable. A `null` id (nothing being edited)
   * is treated as unbindable.
   */
  previewRebind(id: ShortcutId | null, chord: KeyChord): BindingRejection | null {
    if (!id || !this.definition(id).editable) return { reason: 'needs_modifier' };
    if (!hasModifier(chord)) return { reason: 'needs_modifier' };
    const clash = this.findConflict(chord, id);
    if (clash) return { reason: 'conflict', withDescriptionKey: clash.descriptionKey };
    return null;
  }

  /**
   * Try to bind a captured chord to a shortcut. Returns `null` on success, or why it was refused —
   * a binding with no modifier, or one already taken by another shortcut.
   */
  rebind(id: ShortcutId, chord: KeyChord): BindingRejection | null {
    const rejection = this.previewRebind(id, chord);
    if (rejection) return rejection;
    this.overrides.update((current) => ({ ...current, [id]: chord }));
    this.persist();
    return null;
  }

  /** Drop a shortcut's override, returning it to the factory default. */
  resetBinding(id: ShortcutId): void {
    this.overrides.update((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    this.persist();
  }

  /** Apply a preset: replace all overrides with that preset's bindings. */
  applyPreset(presetId: string): void {
    const preset = SHORTCUT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.overrides.set({ ...preset.bindings });
    this.persist();
  }

  /** Whether any shortcut has been customised — enables the "reset all" affordance. */
  readonly hasCustomizations = computed(() => Object.keys(this.overrides()).length > 0);

  resetAll(): void {
    this.overrides.set({});
    this.persist();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private viewFor(def: ShortcutDefinition, overrides: Partial<Record<ShortcutId, KeyChord>>): ShortcutView {
    const override = overrides[def.id];
    return {
      id: def.id,
      descriptionKey: def.descriptionKey,
      editable: def.editable,
      route: def.route,
      chords: override ? [override] : def.defaults,
      customized: Boolean(override),
    };
  }

  private definition(id: ShortcutId): ShortcutDefinition {
    // SHORTCUT_DEFINITIONS is exhaustive over ShortcutId, so this never misses.
    return SHORTCUT_DEFINITIONS.find((def) => def.id === id) as ShortcutDefinition;
  }

  /** The first shortcut whose effective binding equals `chord`, other than `exceptId`. */
  private findConflict(chord: KeyChord, exceptId: ShortcutId): ShortcutDefinition | null {
    const overrides = this.overrides();
    for (const def of SHORTCUT_DEFINITIONS) {
      if (def.id === exceptId) continue;
      const chords = overrides[def.id] ? [overrides[def.id] as KeyChord] : def.defaults;
      if (chords.some((other) => chordsEqual(other, chord))) return def;
    }
    return null;
  }

  private load(): Partial<Record<ShortcutId, KeyChord>> {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Partial<Record<ShortcutId, KeyChord>>) : {};
    } catch {
      return {};
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides()));
    } catch {
      /* storage full or blocked: the binding still works for this session. */
    }
  }
}
