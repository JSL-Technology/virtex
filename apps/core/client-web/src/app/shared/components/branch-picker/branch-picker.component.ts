import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { BranchOption, BranchesService } from '../../../core/tenancy/branches.service';

let nextId = 0;

/**
 * Where a document is issued from, or which branch a list is narrowed to.
 *
 *     <vx-branch-picker formControlName="branchId" />                       a document form
 *     <vx-branch-picker listFilters mode="filter" [(ngModel)]="branch" />   a list or report
 *
 * ## Why one component and not a `<select>` per screen
 *
 * The rules are the same on every document and must not drift: the field is not there at all for a
 * company that does not use branches (most small companies — they should never see the concept);
 * it offers only the branches the person may work at, because the server refuses any other; it
 * starts on the person's default branch, which is the one the server would choose anyway, so what
 * the form shows is what gets recorded; and with a single allowed branch there is nothing to
 * choose, so it is shown read-only rather than as a one-option list.
 *
 * A filter differs in one thing: empty means «every branch I may see», never a default.
 */
@Component({
  selector: 'vx-branch-picker',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './branch-picker.component.html',
  styleUrls: ['./branch-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => VxBranchPickerComponent), multi: true },
  ],
  host: {
    '[class.vx-branch-picker--filter]': "mode() === 'filter'",
    '[hidden]': '!visible()',
  },
})
export class VxBranchPickerComponent implements ControlValueAccessor {
  private readonly branches = inject(BranchesService);

  /** `field` issues a document from a branch; `filter` narrows a list, empty meaning all. */
  readonly mode = input<'field' | 'filter'>('field');
  readonly inputId = input(`vx-branch-picker-${nextId++}`);
  readonly labelKey = input('branches.picker.label');
  /**
   * A field that may be left without a branch — a central warehouse serves every branch. Nothing
   * is proposed, and «no branch» is offered alongside the branches.
   */
  readonly optional = input(false);

  protected readonly options = computed<BranchOption[]>(() => this.branches.mine().branches);
  /**
   * Hidden for a company without branches. A filter is also hidden for someone who works at a
   * single branch: their lists already show only that branch, so there is nothing to narrow.
   */
  protected readonly visible = computed(() =>
    this.mode() === 'filter' ? this.options().length > 1 : this.options().length > 0,
  );
  /** Nothing to choose: the person works at exactly one branch and a branch is required. */
  protected readonly fixed = computed(() => this.options().length === 1 && !this.optional());
  protected readonly value = signal<string | null>(null);
  protected readonly disabled = signal(false);

  private onChange: (value: string | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  /** Whether the form has handed its value over; the default is proposed only after that. */
  private readonly written = signal(false);

  constructor() {
    void this.branches.ensureMine();

    // A document form starts on the branch the server would choose, so the screen shows what will
    // be recorded. Only when the form holds no branch of its own: an existing document keeps its.
    effect(() => {
      const proposed = this.proposedDefault();
      if (!proposed || !this.written() || this.mode() !== 'field' || this.optional()) return;
      untracked(() => {
        if (this.value()) return;
        this.value.set(proposed);
        this.onChange(proposed);
      });
    });
  }

  /** The person's default branch, else their only one, else the headquarters if they may use it. */
  private readonly proposedDefault = computed<string | null>(() => {
    const mine = this.branches.mine();
    if (mine.branches.length === 0) return null;
    if (mine.defaultBranchId && mine.branches.some((b) => b.id === mine.defaultBranchId)) {
      return mine.defaultBranchId;
    }
    if (mine.branches.length === 1) return mine.branches[0].id;
    return mine.branches.find((b) => b.isHeadquarters)?.id ?? null;
  });

  protected label(branch: BranchOption): string {
    return `${branch.code} · ${branch.name}`;
  }

  protected select(raw: string): void {
    const next = raw || null;
    this.value.set(next);
    this.onChange(next);
    this.onTouched();
  }

  protected touched(): void {
    this.onTouched();
  }

  writeValue(value: string | null | undefined): void {
    this.value.set(value || null);
    // Signalled after the write, so the default is never reported to a form mid-`setValue`.
    queueMicrotask(() => this.written.set(true));
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }
}
