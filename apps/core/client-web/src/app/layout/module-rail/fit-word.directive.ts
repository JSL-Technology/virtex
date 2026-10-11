import { AfterViewChecked, Directive, ElementRef, inject } from '@angular/core';

/**
 * Shrinks a label just enough for its longest word to fit its box.
 *
 * The rail names each module in 10px across a 72px column, and some names have one word longer
 * than that in some language — «Contabilidade», «Administración». Breaking inside the word left a
 * lone «g» on the second line («Purchasin / g»), and `hyphens: auto` depends on a dictionary the
 * browser may not have. Shrinking that one label, down to a floor, keeps every word whole.
 */
@Directive({ selector: '[appFitWord]', standalone: true })
export class FitWordDirective implements AfterViewChecked {
  /** Never below this, in px: smaller is no longer a label anyone reads. */
  static readonly MIN_FONT_PX = 8;

  private readonly el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private fittedFor = '';
  private static context: CanvasRenderingContext2D | null | undefined;

  ngAfterViewChecked(): void {
    const text = this.el.textContent?.trim() ?? '';
    const width = this.el.parentElement?.clientWidth ?? 0;
    const key = `${text}|${width}`;
    if (!text || width === 0 || key === this.fittedFor) return;
    this.fittedFor = key;

    this.el.style.fontSize = '';
    const style = getComputedStyle(this.el);
    const base = parseFloat(style.fontSize);
    const longest = this.longestWordWidth(text, style);
    if (!longest || longest <= width) return;
    this.el.style.fontSize = `${Math.max(FitWordDirective.MIN_FONT_PX, Math.floor(base * (width / longest) * 10) / 10)}px`;
  }

  private longestWordWidth(text: string, style: CSSStyleDeclaration): number {
    if (FitWordDirective.context === undefined) {
      FitWordDirective.context = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    }
    const ctx = FitWordDirective.context;
    if (!ctx) return 0;
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return Math.max(...text.split(/\s+/).map((word) => ctx.measureText(word).width));
  }
}
