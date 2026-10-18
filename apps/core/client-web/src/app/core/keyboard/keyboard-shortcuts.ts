/**
 * The product's keyboard shortcuts, described once — as DATA.
 *
 * ## Why a registry and not strings scattered per screen
 *
 * The chord `Alt + Shift + I` used to live as a hand-typed literal in the catalogue, which was
 * wrong three ways at once: it read the same on a Mac as on Windows (a Mac shows ⌥⇧, not
 * "Alt + Shift"), it could silently disagree with the handler that actually listened for the keys,
 * and nothing could enumerate the shortcuts to build a help screen — let alone let the user rebind
 * one. Here a shortcut is a set of modifier flags and a key; {@link formatChord} renders it per
 * platform, the help dialog lists and edits it, and {@link matchesChord} is what the handlers test
 * against, so display, behaviour and customisation are all the same source.
 *
 * ## Modifiers are semantic, not physical
 *
 * `mod` is "the primary accelerator" — ⌘ on a Mac, Ctrl everywhere else — because that is how the
 * same shortcut is spelled on each platform (`⌘W` / `Ctrl+W`). `ctrl` is the LITERAL Control key,
 * kept distinct because the tab-cycling shortcuts are `Ctrl+Tab` on every platform including the
 * Mac (⌘+Tab is the OS app-switcher there and cannot be intercepted). `alt` is ⌥/Alt, `shift` is
 * ⇧/Shift.
 */
export interface KeyChord {
  /** The primary accelerator: ⌘ on macOS, Ctrl elsewhere. */
  mod?: boolean;
  /** The literal Control key (⌃ on macOS), for shortcuts that are Ctrl on every platform. */
  ctrl?: boolean;
  /** ⌥ on macOS, Alt elsewhere. */
  alt?: boolean;
  /** ⇧ on macOS, Shift elsewhere. */
  shift?: boolean;
  /** The main key, as it should read on the chip: `'I'`, `'W'`, `'Tab'`, `'Page Up'`, `'Esc'`. */
  key: string;
  /**
   * The physical `KeyboardEvent.code` a handler matches on, e.g. `'KeyI'`.
   *
   * This exists because `event.key` is unreliable under ⌥ on macOS: Option is a compose key, so
   * Option+Shift+I yields a dead-key character, never `'i'`. `event.code` is the physical key and
   * is stable regardless of modifiers or layout, which is what makes `⌥⇧I` actually fire on a Mac.
   */
  code?: string;
}

/** A shortcut's stable identity, independent of whatever chord is currently bound to it. */
export type ShortcutId =
  | 'create.invoice'
  | 'create.quote'
  | 'create.customer'
  | 'create.product'
  | 'tabs.close'
  | 'tabs.close_others'
  | 'tabs.close_right'
  | 'tabs.close_all'
  | 'tabs.reopen'
  | 'tabs.duplicate'
  | 'tabs.pin'
  | 'tabs.preview_toggle'
  | 'tabs.search'
  | 'tabs.next'
  | 'tabs.previous'
  | 'layout.split_right'
  | 'layout.split_below'
  | 'layout.float'
  | 'layout.popout'
  | 'layout.maximize'
  | 'app.show_shortcuts'
  | 'app.search'
  | 'app.settings'
  | 'app.help'
  | 'app.back'
  | 'app.forward'
  | 'app.report_problem'
  | 'general.dismiss';

export interface ShortcutDefinition {
  id: ShortcutId;
  /** Catalogue key for the human description — reused from `actions.*`/`tabs.*` where one exists. */
  descriptionKey: string;
  /** Which group it is listed under. */
  groupId: 'create' | 'tabs' | 'layout' | 'general';
  /** The factory default binding(s). The user may override the first; the rest are alternates. */
  defaults: KeyChord[];
  /**
   * The binding in the desktop app, where the window is ours and the editor-style chords a browser
   * keeps for itself (Ctrl+W, Ctrl+Shift+T, Ctrl+Tab) can be honoured. Absent: same as `defaults`.
   */
  desktopDefaults?: KeyChord[];
  /** Whether the reader may rebind it. Conventions (Esc, Ctrl+Tab cycling) are fixed. */
  editable: boolean;
  /** Present on create shortcuts: the route the shell navigates to. */
  route?: string;
}

export interface ShortcutGroupMeta {
  id: ShortcutDefinition['groupId'];
  titleKey: string;
}

/** Groups in the order the help dialog shows them. */
export const SHORTCUT_GROUPS: readonly ShortcutGroupMeta[] = [
  { id: 'create', titleKey: 'main.shortcuts.group_create' },
  { id: 'tabs', titleKey: 'main.shortcuts.group_tabs' },
  { id: 'layout', titleKey: 'main.shortcuts.group_layout' },
  { id: 'general', titleKey: 'main.shortcuts.group_general' },
];

/**
 * Every shortcut the product has. The one place a chord is declared; everything else — the create
 * menu, the tab handler, the tab context menu, the help dialog, the stored overrides — reads from
 * here by id.
 *
 * ## Why the web defaults are all `Alt+Shift` (QA A-14)
 *
 * The first defaults copied a desktop editor: Ctrl+W, Ctrl+Shift+T, Ctrl+Tab, Ctrl+Shift+A, and a
 * family of Ctrl+Alt chords. In a browser the first four belong to the browser — Ctrl+W closes the
 * BROWSER tab, with whatever was unsaved in it, and cannot be intercepted — and Ctrl+Alt is AltGr
 * on the Spanish and Latin American Windows layouts this product is sold on, the key used to type
 * `@`, `[`, `]`, `{`, `}` and `\`. So on the web every default is `Alt+Shift` plus a mnemonic
 * key: free in Chrome, Edge, Firefox and Safari, never AltGr, and never fired while typing in a
 * field (see `ShortcutsService.matches`). The desktop app, whose window is ours, keeps the
 * editor-style chords through `desktopDefaults`. All of them remain editable.
 */
const altShift = (key: string, code: string): KeyChord => ({ alt: true, shift: true, key, code });

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  { id: 'create.invoice', descriptionKey: 'actions.new_invoice', groupId: 'create', editable: true, route: '/invoices/new', defaults: [altShift('I', 'KeyI')] },
  { id: 'create.quote', descriptionKey: 'actions.new_quote', groupId: 'create', editable: true, route: '/quotes/new', defaults: [altShift('Q', 'KeyQ')] },
  { id: 'create.customer', descriptionKey: 'actions.new_customer', groupId: 'create', editable: true, route: '/contacts/customers/new', defaults: [altShift('C', 'KeyC')] },
  { id: 'create.product', descriptionKey: 'actions.new_product', groupId: 'create', editable: true, route: '/inventory/products/new', defaults: [altShift('P', 'KeyP')] },

  { id: 'tabs.close', descriptionKey: 'main.shortcuts.close_tab', groupId: 'tabs', editable: true, defaults: [altShift('W', 'KeyW')], desktopDefaults: [{ mod: true, key: 'W', code: 'KeyW' }] },
  { id: 'tabs.close_others', descriptionKey: 'tabs.close_others', groupId: 'tabs', editable: true, defaults: [altShift('O', 'KeyO')] },
  { id: 'tabs.close_right', descriptionKey: 'tabs.close_right', groupId: 'tabs', editable: true, defaults: [altShift('End', 'End')] },
  { id: 'tabs.close_all', descriptionKey: 'tabs.close_all', groupId: 'tabs', editable: true, defaults: [altShift('X', 'KeyX')] },
  { id: 'tabs.reopen', descriptionKey: 'main.shortcuts.reopen_tab', groupId: 'tabs', editable: true, defaults: [altShift('T', 'KeyT')], desktopDefaults: [{ mod: true, shift: true, key: 'T', code: 'KeyT' }] },
  { id: 'tabs.search', descriptionKey: 'main.shortcuts.search_tabs', groupId: 'tabs', editable: true, defaults: [altShift('A', 'KeyA')] },
  { id: 'tabs.duplicate', descriptionKey: 'tabs.duplicate', groupId: 'tabs', editable: true, defaults: [altShift('D', 'KeyD')] },
  { id: 'tabs.pin', descriptionKey: 'tabs.pin', groupId: 'tabs', editable: true, defaults: [altShift('G', 'KeyG')] },
  { id: 'tabs.preview_toggle', descriptionKey: 'tabs.preview_on_open', groupId: 'tabs', editable: true, defaults: [altShift('V', 'KeyV')] },
  {
    id: 'tabs.next', descriptionKey: 'main.shortcuts.next_tab', groupId: 'tabs', editable: false,
    defaults: [altShift('Page Down', 'PageDown')],
    desktopDefaults: [{ ctrl: true, key: 'Tab', code: 'Tab' }, { ctrl: true, key: 'Page Down', code: 'PageDown' }],
  },
  {
    id: 'tabs.previous', descriptionKey: 'main.shortcuts.previous_tab', groupId: 'tabs', editable: false,
    defaults: [altShift('Page Up', 'PageUp')],
    desktopDefaults: [{ ctrl: true, shift: true, key: 'Tab', code: 'Tab' }, { ctrl: true, key: 'Page Up', code: 'PageUp' }],
  },

  { id: 'layout.split_right', descriptionKey: 'tabs.split_right', groupId: 'layout', editable: true, defaults: [altShift('S', 'KeyS')] },
  { id: 'layout.split_below', descriptionKey: 'tabs.split_below', groupId: 'layout', editable: true, defaults: [altShift('B', 'KeyB')] },
  { id: 'layout.float', descriptionKey: 'tabs.float', groupId: 'layout', editable: true, defaults: [altShift('F', 'KeyF')] },
  { id: 'layout.popout', descriptionKey: 'tabs.pop_out_window', groupId: 'layout', editable: true, defaults: [altShift('U', 'KeyU')] },
  { id: 'layout.maximize', descriptionKey: 'tabs.maximise', groupId: 'layout', editable: true, defaults: [altShift('M', 'KeyM')] },

  //  Global application shortcuts, after Teams' "General" group but kept to the ones an ERP
  //  actually has an action for — no meeting/compose/Copilot keys. All editable.
  { id: 'app.show_shortcuts', descriptionKey: 'main.shortcuts.show_shortcuts', groupId: 'general', editable: true, defaults: [{ mod: true, key: '.', code: 'Period' }] },
  //  Ctrl/⌘+K, the command-palette convention, rather than Ctrl+E, which Chrome and Edge use to
  //  put the cursor in their own address bar.
  { id: 'app.search', descriptionKey: 'main.shortcuts.search', groupId: 'general', editable: true, defaults: [{ mod: true, key: 'K', code: 'KeyK' }] },
  //  ⌘, opens the BROWSER's settings on a Mac; Alt+Shift+, is free everywhere.
  { id: 'app.settings', descriptionKey: 'nav.settings', groupId: 'general', editable: true, defaults: [altShift(',', 'Comma')], desktopDefaults: [{ mod: true, key: ',', code: 'Comma' }] },
  { id: 'app.help', descriptionKey: 'user.help', groupId: 'general', editable: true, defaults: [{ key: 'F1', code: 'F1' }] },
  { id: 'app.back', descriptionKey: 'main.shortcuts.go_back', groupId: 'general', editable: true, defaults: [altShift('←', 'ArrowLeft')], desktopDefaults: [{ mod: true, key: '[', code: 'BracketLeft' }] },
  { id: 'app.forward', descriptionKey: 'main.shortcuts.go_forward', groupId: 'general', editable: true, defaults: [altShift('→', 'ArrowRight')], desktopDefaults: [{ mod: true, key: ']', code: 'BracketRight' }] },
  { id: 'app.report_problem', descriptionKey: 'main.shortcuts.report_problem', groupId: 'general', editable: true, defaults: [altShift('R', 'KeyR')] },

  { id: 'general.dismiss', descriptionKey: 'main.shortcuts.dismiss', groupId: 'general', editable: false, defaults: [{ key: 'Esc', code: 'Escape' }] },
];

/** The glyphs a Mac prints for each modifier, in the order macOS itself lays them out. */
const MAC_GLYPHS = { ctrl: '⌃', alt: '⌥', shift: '⇧', mod: '⌘' } as const;

/**
 * Render a chord to the tokens a `<kbd>` row shows — `['⌥','⇧','I']` on a Mac, `['Alt','Shift','I']`
 * elsewhere. Modifier order follows each platform's convention: Mac is ⌃⌥⇧⌘, Windows/Linux leads
 * with the accelerator.
 */
export function formatChord(chord: KeyChord, isMac: boolean): string[] {
  const tokens: string[] = [];
  if (isMac) {
    if (chord.ctrl) tokens.push(MAC_GLYPHS.ctrl);
    if (chord.alt) tokens.push(MAC_GLYPHS.alt);
    if (chord.shift) tokens.push(MAC_GLYPHS.shift);
    if (chord.mod) tokens.push(MAC_GLYPHS.mod);
  } else {
    // `mod` and a literal `ctrl` both read "Ctrl" off the Mac; show it once if either is set.
    if (chord.mod || chord.ctrl) tokens.push('Ctrl');
    if (chord.alt) tokens.push('Alt');
    if (chord.shift) tokens.push('Shift');
  }
  tokens.push(chord.key);
  return tokens;
}

/**
 * The same chord as a sentence a screen reader can speak — "Command Shift I", never "⌘ ⇧ I", which
 * most readers voice as the glyphs' Unicode names ("place of interest sign"). Key names are proper
 * nouns of the keyboard and read the same in every language, so this is not translated.
 */
export function speakChord(chord: KeyChord, isMac: boolean): string {
  const parts: string[] = [];
  if (isMac) {
    // Spoken order leads with the accelerator — people say "Command Shift T", not "Shift Command
    // T" — which can differ from the visual glyph order (⌃⌥⇧⌘) on purpose.
    if (chord.mod) parts.push('Command');
    if (chord.ctrl) parts.push('Control');
    if (chord.alt) parts.push('Option');
    if (chord.shift) parts.push('Shift');
  } else {
    if (chord.mod || chord.ctrl) parts.push('Control');
    if (chord.alt) parts.push('Alt');
    if (chord.shift) parts.push('Shift');
  }
  parts.push(chord.key);
  return parts.join(' ');
}

/** True when the chord carries at least one modifier — the rule for a shortcut worth binding. */
export function hasModifier(chord: KeyChord): boolean {
  return Boolean(chord.mod || chord.ctrl || chord.alt || chord.shift);
}

/** Human label for a physical key, for a chord captured from the keyboard. */
const CODE_LABELS: Readonly<Record<string, string>> = {
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`',
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Esc', Tab: 'Tab',
  Backspace: '⌫', Delete: 'Del', Insert: 'Ins',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
};

function keyLabelFromEvent(event: KeyboardEvent): string {
  const code = event.code;
  if (code.startsWith('Key')) return code.slice(3); // KeyI → I
  if (code.startsWith('Digit')) return code.slice(5); // Digit3 → 3
  if (code.startsWith('Numpad') && /\d$/.test(code)) return code.slice(-1); // Numpad3 → 3
  if (/^F\d{1,2}$/.test(code)) return code; // F1…F12
  return CODE_LABELS[code] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS']);

/**
 * Build a {@link KeyChord} from a keydown — what the editor records. Returns `null` while only
 * modifiers are held, so the capture waits for the real key. Off a Mac the Ctrl key is recorded as
 * `mod` (the accelerator), so a chord bound in the browser spells and matches correctly.
 */
export function chordFromKeyboardEvent(event: KeyboardEvent, isMac: boolean): KeyChord | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const chord: KeyChord = { key: keyLabelFromEvent(event), code: event.code };
  if (isMac) {
    if (event.metaKey) chord.mod = true;
    if (event.ctrlKey) chord.ctrl = true;
  } else if (event.ctrlKey) {
    chord.mod = true;
  }
  if (event.altKey) chord.alt = true;
  if (event.shiftKey) chord.shift = true;
  return chord;
}

/** Whether a keydown is the chord — exact modifiers, right physical key. */
export function matchesChord(event: KeyboardEvent, chord: KeyChord, isMac: boolean): boolean {
  // AltGr is a CHARACTER key on Spanish and Latin American layouts — it types @ [ ] { } \ — and on
  // Windows it arrives as Ctrl+Alt. Nothing typed with it is ever a shortcut (QA A-14).
  if (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) return false;
  const codeOk = chord.code
    ? event.code === chord.code
    : chord.key.length === 1
      ? event.key.toUpperCase() === chord.key.toUpperCase()
      : event.key === chord.key;
  if (!codeOk) return false;

  const wantMeta = isMac ? Boolean(chord.mod) : false;
  const wantCtrl = isMac ? Boolean(chord.ctrl) : Boolean(chord.mod || chord.ctrl);
  return (
    event.metaKey === wantMeta &&
    event.ctrlKey === wantCtrl &&
    event.altKey === Boolean(chord.alt) &&
    event.shiftKey === Boolean(chord.shift)
  );
}

/** Whether two chords are the same binding — same modifiers, same key. */
export function chordsEqual(a: KeyChord, b: KeyChord): boolean {
  const sameKey = a.code && b.code ? a.code === b.code : a.key.toUpperCase() === b.key.toUpperCase();
  return (
    Boolean(a.mod) === Boolean(b.mod) &&
    Boolean(a.ctrl) === Boolean(b.ctrl) &&
    Boolean(a.alt) === Boolean(b.alt) &&
    Boolean(a.shift) === Boolean(b.shift) &&
    sameKey
  );
}
