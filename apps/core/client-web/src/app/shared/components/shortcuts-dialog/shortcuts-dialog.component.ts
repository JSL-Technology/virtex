import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { LucideAngularModule, Search, Pencil, RotateCcw, ChevronDown } from 'lucide-angular';
import { VxDialogComponent } from '../dialog/dialog.component';
import { VxKbdComponent } from '../kbd';
import { PlatformService } from '../../../core/platform/platform.service';
import {
  BindingRejection,
  ShortcutGroupView,
  ShortcutsService,
} from '../../../core/keyboard/shortcuts.service';
import {
  KeyChord,
  ShortcutId,
  chordFromKeyboardEvent,
  formatChord,
} from '../../../core/keyboard/keyboard-shortcuts';

/**
 * The "Keyboard shortcuts" window — list, search, group and (unlike before) EDIT every shortcut,
 * after Microsoft Teams' keyboard-shortcuts dialog.
 *
 * ## What it does
 *
 * - Lists every shortcut grouped and in two columns, each with its chord drawn for the reader's
 *   platform ({@link VxKbdComponent}).
 * - Filters live as you type.
 * - Rebinds a shortcut inline: the pencil turns the row into a capture box, the next chord you
 *   press is validated (it must carry a modifier and must not already be taken) and, on Enter,
 *   saved through {@link ShortcutsService} — which every handler reads, so the new keys work at
 *   once. Esc cancels; a customised row can be reset to its default.
 * - A preset selector ("Use shortcuts from other apps") and a "reset all".
 *
 * ## Why the capture has to silence the global handlers
 *
 * The tab service listens on `window` in the CAPTURE phase, so it would act on `⌘W` before this
 * box ever saw it. While editing, `ShortcutsService.capturing` is set and those handlers stand
 * down; `stopPropagation` here also keeps the chord from reaching the dialog's own Escape-to-close.
 */
@Component({
  selector: 'app-shortcuts-dialog',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, VxDialogComponent, VxKbdComponent],
  templateUrl: './shortcuts-dialog.component.html',
  styleUrls: ['./shortcuts-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShortcutsDialogComponent implements OnDestroy {
  private readonly shortcuts = inject(ShortcutsService);
  private readonly platform = inject(PlatformService);
  private readonly translate = inject(TranslateService);

  /** Emitted when the dialog asks to close (close button, scrim or Escape). */
  readonly dismissed = output<void>();
  /** Footer links, wired by the shell to its Help and Feedback flows. */
  readonly help = output<void>();
  readonly reportProblem = output<void>();

  protected readonly SearchIcon = Search;
  protected readonly PencilIcon = Pencil;
  protected readonly ResetIcon = RotateCcw;
  protected readonly ChevronIcon = ChevronDown;

  protected readonly presets = this.shortcuts.presets;
  protected readonly hasCustomizations = this.shortcuts.hasCustomizations;

  protected readonly filter = signal('');
  protected readonly selectedPreset = signal('default');
  private readonly collapsed = signal<ReadonlySet<string>>(new Set());

  protected readonly editingId = signal<ShortcutId | null>(null);
  protected readonly pendingChord = signal<KeyChord | null>(null);
  protected readonly rejection = signal<BindingRejection | null>(null);

  private readonly captureEl = viewChild<ElementRef<HTMLElement>>('capture');

  /** Groups filtered by the search box; a group with no matches disappears. */
  protected readonly filteredGroups = computed<ShortcutGroupView[]>(() => {
    const query = this.filter().trim().toLowerCase();
    const groups = this.shortcuts.groups();
    if (!query) return groups;

    const isMac = this.platform.isMac();
    return groups
      .map((group) => ({
        ...group,
        shortcuts: group.shortcuts.filter((shortcut) => {
          const description = this.translate.instant(shortcut.descriptionKey).toLowerCase();
          const keys = shortcut.chords.map((c) => formatChord(c, isMac).join('')).join(' ').toLowerCase();
          return description.includes(query) || keys.includes(query);
        }),
      }))
      .filter((group) => group.shortcuts.length > 0);
  });

  constructor() {
    // Put the keyboard inside the capture box the moment a row enters edit mode.
    effect(() => {
      if (this.editingId()) this.captureEl()?.nativeElement.focus();
    });
  }

  protected isCollapsed(groupId: string): boolean {
    return this.collapsed().has(groupId);
  }

  protected toggleGroup(groupId: string): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  protected onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  protected onPresetChange(event: Event): void {
    this.selectedPreset.set((event.target as HTMLSelectElement).value);
  }

  protected applyPreset(): void {
    this.cancelEdit();
    this.shortcuts.applyPreset(this.selectedPreset());
  }

  // ── Editing ──────────────────────────────────────────────────────────────

  protected startEdit(id: ShortcutId): void {
    this.editingId.set(id);
    this.pendingChord.set(null);
    this.rejection.set(null);
    this.shortcuts.capturing.set(true);
  }

  protected onCaptureKeydown(event: KeyboardEvent): void {
    // The editor owns the keyboard while a box is focused: nothing else should see these keys.
    event.preventDefault();
    event.stopPropagation();

    const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (event.key === 'Escape' && bare) return this.cancelEdit();
    if (event.key === 'Enter' && bare) return this.commitEdit();

    const chord = chordFromKeyboardEvent(event, this.platform.isMac());
    if (!chord) return; // only modifiers held so far — wait for the real key
    this.pendingChord.set(chord);
    this.rejection.set(this.validate(chord));
  }

  /** Clicking or tabbing away from the capture box abandons the edit, as in Teams. */
  protected onCaptureBlur(): void {
    if (this.editingId()) this.cancelEdit();
  }

  protected commitEdit(): void {
    const id = this.editingId();
    const chord = this.pendingChord();
    if (!id || !chord) return this.cancelEdit();
    const rejected = this.shortcuts.rebind(id, chord);
    if (rejected) {
      this.rejection.set(rejected);
      return; // stay in edit so the reader can try another combo
    }
    this.endEdit();
  }

  protected cancelEdit(): void {
    this.endEdit();
  }

  protected resetBinding(id: ShortcutId): void {
    this.shortcuts.resetBinding(id);
  }

  protected resetAll(): void {
    this.cancelEdit();
    this.shortcuts.resetAll();
  }

  protected onDismiss(): void {
    this.cancelEdit();
    this.dismissed.emit();
  }

  ngOnDestroy(): void {
    // A dialog torn down mid-edit must not leave the global handlers muted.
    if (this.shortcuts.capturing()) this.shortcuts.capturing.set(false);
  }

  /** Validate a candidate without saving, so the capture box can warn before Enter. */
  private validate(chord: KeyChord): BindingRejection | null {
    return this.shortcuts.previewRebind(this.editingId(), chord);
  }

  private endEdit(): void {
    this.editingId.set(null);
    this.pendingChord.set(null);
    this.rejection.set(null);
    this.shortcuts.capturing.set(false);
  }
}
