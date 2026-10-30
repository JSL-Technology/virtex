import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl } from '@angular/forms';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { TranslateService } from '@ngx-translate/core';
import { DraftProblem, problemForControl } from '../gestures';

/**
 * The message under a field that is wrong, worded like the draft summary.
 *
 * A red border said «something is wrong here» to the eye only (WCAG 1.4.1), and only the summary
 * at the top said what. This puts the same sentence under the field, with the id
 * `<fieldId>-error` that `InvalidFieldDirective` wires into the input's `aria-describedby`, so a
 * screen reader hears it on focus.
 *
 * Shown on the same condition the directive marks the field invalid: invalid and touched.
 */
@Component({
  selector: 'vx-field-error',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (problem(); as problem) {
      <p class="vx-field-error" [id]="fieldId() + '-error'">{{ problem.message | translate: problem.params }}</p>
    }
  `,
  styles: [
    `
      .vx-field-error {
        margin: 0.25rem 0 0;
        font-size: var(--text-xs);
        line-height: 1.35;
        color: var(--error-text);
      }
    `,
  ],
})
export class VxFieldErrorComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);

  readonly control = input.required<AbstractControl | null>();
  /** The input's id; the message takes `<fieldId>-error`. */
  readonly fieldId = input.required<string>();
  /** The i18n key of the field's label, the same the `<label>` shows. */
  readonly labelKey = input.required<string>();

  protected readonly problem = signal<DraftProblem | null>(null);

  ngOnInit(): void {
    const control = this.control();
    if (!control) return;
    const refresh = () => {
      const problem = control.touched ? problemForControl(this.fieldId(), this.labelKey(), control) : null;
      // The message names the field in the reader's language, as the summary does.
      this.problem.set(problem ? { ...problem, params: { ...problem.params, field: this.translate.instant(this.labelKey()) } } : null);
    };
    refresh();
    control.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(refresh);
  }
}
