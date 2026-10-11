import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { PlatformService } from '../../../core/platform/platform.service';
import { KeyChord, formatChord, speakChord } from '../../../core/keyboard/keyboard-shortcuts';

/**
 * A keyboard shortcut, rendered as a row of `<kbd>` chips — `⌥⇧I` on a Mac, `Alt Shift I` elsewhere.
 *
 * ## Why a component and not a translated string
 *
 * The chord used to be a literal in the catalogue (`"Alt + Shift + I"`), which read wrong on a Mac
 * and could not adapt to the platform. Here the component takes the chord as DATA and asks
 * {@link PlatformService} which glyphs to draw, so the same shortcut shows ⌘ on macOS and Ctrl on
 * Windows from one definition. It is used both in the create menu and the keyboard-shortcuts help.
 *
 * ## Accessibility
 *
 * The glyphs are announced badly by screen readers (⌘ is "place of interest sign"), so the visible
 * chips are `aria-hidden` and the whole control carries a spoken label built by {@link speakChord}
 * — "Command Shift T" — exposed as `role="img"`.
 */
@Component({
  selector: 'vx-kbd',
  standalone: true,
  template: `@for (token of tokens(); track $index) {
    <kbd class="vx-kbd__key" aria-hidden="true">{{ token }}</kbd>
  }`,
  styleUrls: ['./kbd.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'vx-kbd',
    role: 'img',
    '[attr.aria-label]': 'ariaLabel()',
  },
})
export class VxKbdComponent {
  private readonly platform = inject(PlatformService);

  /** The shortcut to render. */
  readonly chord = input.required<KeyChord>();

  protected readonly tokens = computed(() => formatChord(this.chord(), this.platform.isMac()));
  protected readonly ariaLabel = computed(() => speakChord(this.chord(), this.platform.isMac()));
}
