import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

/**
 * A draggable divider that resizes an adjacent panel — the grip VS Code puts between the sidebar
 * and the editor.
 *
 * ## Why a component and not a one-off handler
 *
 * Resizing done right is more than a mousedown: it has to follow the pointer even when it leaves
 * the 6px grip, work with touch and pen, not select text mid-drag, be reachable and operable from
 * the keyboard, and announce itself to a screen reader. Packing that into a reusable control means
 * every resizable panel gets the same correct behaviour instead of each re-deriving half of it.
 *
 * ## How it talks to the panel
 *
 * It does not own the width. It MEASURES the live target at the start of each gesture and emits the
 * new width through `sizeChange`; the host decides what to do with it (store it, clamp it, write a
 * CSS variable). That keeps the width a single source of truth outside the handle and lets the same
 * handle drive a grid column, a flex-basis or an inline width without knowing which.
 *
 * ## Robustness
 *
 * Pointer Events + `setPointerCapture` route every move to the grip once a drag starts, so the drag
 * survives the cursor crossing into the content area or moving fast. `touch-action: none` stops a
 * touch drag from scrolling the page instead of resizing.
 */
@Component({
  selector: 'vx-resize-handle',
  standalone: true,
  template: '',
  styleUrls: ['./resize-handle.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'vx-resize-handle',
    role: 'separator',
    'aria-orientation': 'vertical',
    tabindex: '0',
    '[class.vx-resize-handle--end]': "edge() === 'end'",
    '[class.vx-resize-handle--start]': "edge() === 'start'",
    '[class.is-active]': 'dragging()',
    '[attr.aria-label]': 'ariaLabel()',
    '[attr.aria-valuemin]': 'min()',
    '[attr.aria-valuemax]': 'max()',
    '[attr.aria-valuenow]': 'currentSize()',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp($event)',
    '(pointercancel)': 'onPointerUp($event)',
    '(lostpointercapture)': 'onPointerUp($event)',
    '(keydown)': 'onKeydown($event)',
    '(dblclick)': 'resetSize.emit()',
    '(focus)': 'syncSize()',
  },
})
export class VxResizeHandleComponent {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The element whose width this handle resizes; measured live at the start of each gesture. */
  readonly target = input.required<HTMLElement>();
  /** Which edge of the target the grip sits on. `end` (right) grows as you drag right. */
  readonly edge = input<'start' | 'end'>('end');
  readonly min = input<number>(160);
  readonly max = input<number>(520);
  /** How many px each arrow-key press moves the edge. */
  readonly step = input<number>(16);
  readonly ariaLabel = input<string>('Resize');

  /** The new width, emitted continuously while dragging and on each keystroke. */
  readonly sizeChange = output<number>();
  readonly resizeStart = output<void>();
  readonly resizeEnd = output<void>();
  /** Double-click asks the host to restore the default width. (Not `reset`: that is a native event.) */
  readonly resetSize = output<void>();

  protected readonly dragging = signal(false);
  /** Last known width, for `aria-valuenow`. */
  protected readonly currentSize = signal(0);

  private startX = 0;
  private startWidth = 0;

  /** `end` grows with a rightward drag; `start` (grip on a panel's left) shrinks. */
  private get sign(): number {
    return this.edge() === 'end' ? 1 : -1;
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.startX = event.clientX;
    this.startWidth = this.measure();
    this.dragging.set(true);
    this.el.nativeElement.setPointerCapture(event.pointerId);
    this.resizeStart.emit();
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.dragging()) return;
    this.apply(this.startWidth + (event.clientX - this.startX) * this.sign);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.dragging()) return;
    this.dragging.set(false);
    try {
      this.el.nativeElement.releasePointerCapture(event.pointerId);
    } catch {
      /* capture already released (e.g. pointercancel) */
    }
    this.resizeEnd.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = this.measure() + this.step() * this.sign;
        break;
      case 'ArrowLeft':
        next = this.measure() - this.step() * this.sign;
        break;
      case 'Home':
        next = this.min();
        break;
      case 'End':
        next = this.max();
        break;
      default:
        return;
    }
    event.preventDefault();
    this.apply(next);
  }

  protected syncSize(): void {
    this.currentSize.set(Math.round(this.measure()));
  }

  private apply(width: number): void {
    const clamped = Math.min(this.max(), Math.max(this.min(), Math.round(width)));
    this.currentSize.set(clamped);
    this.sizeChange.emit(clamped);
  }

  private measure(): number {
    return this.target()?.getBoundingClientRect().width ?? this.currentSize();
  }
}
