import { Directive, ElementRef, effect, inject, signal } from '@angular/core';
import { NgControl } from '@angular/forms';
import { Subscription } from 'rxjs';

/**
 * Tells assistive technology which field is the one to fix.
 *
 * The forms in this product report validation well enough to look at: a summary at the top
 * ("Check 3 item(s) before saving"), a message under each field, and a link from the summary to
 * the input. All of it is visual. Of 323 form controls in the client, exactly one carried
 * `aria-invalid` — the one-time-code boxes — so a screen reader user was told a form had errors
 * and then read the same neutral field list as before, with nothing marking any of them. They can
 * hear that saving failed; they cannot find out where.
 *
 * ## Why a directive and not an attribute on each input
 *
 * 323 bindings is 323 chances to write `form.get('x')?.invalid` against the wrong control, and a
 * field added later would silently arrive without one. The control already knows its own validity;
 * this reads it from `NgControl` and needs nothing from the template but the directive being in
 * scope.
 *
 * ## Why `touched`, and not `invalid` alone
 *
 * An untouched required field is invalid from the moment the form is built. Announcing that on a
 * freshly opened form marks every empty field as an error before the user has typed anything,
 * which is the accessible equivalent of a form that turns red on arrival. `touched` covers both
 * moments that matter: the user has left the field, or the page called `markAllAsTouched()`
 * because they pressed Save — which is exactly what the shared draft gesture does when validation
 * refuses a submit.
 *
 * `attr.aria-invalid` is removed rather than set to `"false"` when the field is fine: absent is
 * the default, and an explicit `false` on every input is noise in the accessibility tree.
 */
@Directive({
  selector: '[formControlName],[formControl],[ngModel]',
  standalone: true,
})
export class InvalidFieldDirective {
  private readonly control = inject(NgControl, { self: true, optional: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Bumped on every status change, so the effect below re-reads a value that is not a signal. */
  private readonly revision = signal(0);

  constructor() {
    let subscription: Subscription | null = null;

    effect((onCleanup) => {
      const control = this.control?.control;
      if (!control) return;

      if (!subscription) {
        //  `events` and not `statusChanges`: becoming touched is not a status change, and
        //  `markAllAsTouched()` — which is exactly how the shared draft gesture reacts to a
        //  refused submit — emits no status at all. `events` carries `TouchedChangeEvent`
        //  alongside the validity ones, so both halves of the condition below are covered by one
        //  subscription.
        subscription = control.events.subscribe(() =>
          this.revision.update((value) => value + 1),
        );
        onCleanup(() => {
          subscription?.unsubscribe();
          subscription = null;
        });
      }

      this.revision();
      this.apply(control.invalid && control.touched);
    });
  }

  private apply(invalid: boolean): void {
    const element = this.host.nativeElement;
    if (invalid) element.setAttribute('aria-invalid', 'true');
    else element.removeAttribute('aria-invalid');
  }
}

/**
 * Spread into a standalone component's `imports` beside `ReactiveFormsModule`.
 *
 * A const array rather than the directive on its own so the next thing every form should carry —
 * `aria-describedby` pointing at its error text, say — can be added in one place instead of in
 * sixty.
 */
export const VX_FORM_A11Y = [InvalidFieldDirective] as const;
