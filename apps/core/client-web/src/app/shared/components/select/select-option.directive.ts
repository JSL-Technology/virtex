import { Directive, TemplateRef, inject } from '@angular/core';

/** What the option template is handed. Named so a caller can type their own `let-` variables. */
export interface VxSelectOptionContext<TOption> {
  $implicit: TOption;
  /** What the user has typed, so a caller can highlight the match. */
  query: string;
  /** True while the keyboard is on this row. */
  active: boolean;
  /** True when this row is the value the field currently holds. */
  selected: boolean;
}

/**
 * The caller's own rendering for one row of the list.
 *
 *     <vx-select [search]="findCustomers" [displayWith]="customerName">
 *       <ng-template appVxSelectOption let-customer let-query="query">
 *         <strong>{{ customer.companyName }}</strong>
 *         <small>{{ customer.taxId }}</small>
 *       </ng-template>
 *     </vx-select>
 *
 * Optional. Without it the component draws `displayWith` and, when given, `describeWith` — which
 * is enough for most fields and keeps the common case to two inputs.
 *
 * `displayWith` is still required even when this template is supplied: the closed field and the
 * accessible name are text, not markup, and a screen reader cannot read a `<strong>`.
 */
@Directive({
  selector: 'ng-template[appVxSelectOption]',
  standalone: true,
})
export class VxSelectOptionDirective<TOption = unknown> {
  readonly template = inject<TemplateRef<VxSelectOptionContext<TOption>>>(TemplateRef);

  /** Lets `let-customer` be typed as the option instead of `any`. */
  static ngTemplateContextGuard<T>(
    _directive: VxSelectOptionDirective<T>,
    context: unknown,
  ): context is VxSelectOptionContext<T> {
    return true;
  }
}
