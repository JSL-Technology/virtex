import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  ViewContainerRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { Branch, BranchesService } from '../../../../core/tenancy/branches.service';
import { NotificationService } from '../../../../core/services/notification';
import { StepUpScope, StepUpService } from '../../../../core/services/step-up.service';
import { VxDialogComponent } from '../../../../shared/components/dialog';
import { VxSpinnerComponent } from '../../../../shared/components/feedback';

/**
 * Which branches one person may work at, and which one their documents start on.
 *
 * «All branches» is the default and is stored as no rows at all, so a branch opened next year is
 * open to everyone who was not deliberately limited. Limiting someone is an access decision —
 * a cashier who can only sell from one store — so it asks for the same confirmation as changing
 * their roles, and it lives beside the roles rather than in the branch screen.
 */
@Component({
  selector: 'app-user-branch-access-dialog',
  standalone: true,
  imports: [TranslateModule, VxDialogComponent, VxSpinnerComponent],
  templateUrl: './branch-access.dialog.html',
  styleUrls: ['./branch-access.dialog.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserBranchAccessDialogComponent implements OnInit {
  private readonly api = inject(BranchesService);
  private readonly notifications = inject(NotificationService);
  private readonly stepUp = inject(StepUpService);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly userId = input.required<string>();
  readonly userName = input.required<string>();
  readonly closed = output<void>();

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly branches = signal<Branch[]>([]);
  /** Every branch, or only those in `selected`. */
  readonly allBranches = signal(true);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly defaultBranchId = signal<string | null>(null);

  /** The branches the default may be chosen from: the allowed ones. */
  readonly defaultChoices = computed(() => {
    const active = this.branches().filter((b) => b.isActive);
    return this.allBranches() ? active : active.filter((b) => this.selected().has(b.id));
  });

  readonly invalid = computed(() => !this.allBranches() && this.selected().size === 0);

  ngOnInit(): void {
    forkJoin({ branches: this.api.list(), access: this.api.getAccess(this.userId()) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ branches, access }) => {
          this.branches.set(branches);
          this.allBranches.set(access.branchIds.length === 0);
          this.selected.set(new Set(access.branchIds));
          this.defaultBranchId.set(access.defaultBranchId);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.notifications.showHttpError(error, 'branches.access.load_failed');
          this.closed.emit();
        },
      });
  }

  setAll(all: boolean): void {
    this.allBranches.set(all);
    this.dropDefaultIfOutside();
  }

  toggle(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
    this.dropDefaultIfOutside();
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  setDefault(value: string): void {
    this.defaultBranchId.set(value || null);
  }

  /** A default the person may no longer use would be refused by the server; clear it here first. */
  private dropDefaultIfOutside(): void {
    const current = this.defaultBranchId();
    if (current && !this.defaultChoices().some((b) => b.id === current)) this.defaultBranchId.set(null);
  }

  save(): void {
    if (this.invalid()) return;
    const body = {
      // Kept in catalogue order so the stored list does not depend on the order of the clicks.
      branchIds: this.allBranches() ? [] : this.branches().filter((b) => this.selected().has(b.id)).map((b) => b.id),
      defaultBranchId: this.defaultBranchId(),
    };
    this.saving.set(true);
    this.stepUp
      .requireStepUp(StepUpScope.MANAGE_ROLES, this.viewContainerRef, () => this.api.setAccess(this.userId(), body))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.notifications.showSuccess('branches.access.saved');
          this.closed.emit();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'branches.access.save_failed');
        },
      });
  }
}
