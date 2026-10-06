import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { BranchesService } from '../../../core/tenancy/branches.service';

/**
 * The branch a document came from, as `code · name`, for a list cell or a document header.
 *
 * Renders nothing when the document has no branch — every document of a company that does not
 * use them — so a screen can place it unconditionally. Reactive to the branch list, which loads
 * once per company and is shared with every picker on screen.
 */
@Component({
  selector: 'vx-branch-label',
  standalone: true,
  template: `{{ text() }}`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.title]': 'text() || null' },
})
export class VxBranchLabelComponent {
  private readonly branches = inject(BranchesService);

  readonly branchId = input<string | null | undefined>(null);

  protected readonly text = computed(() => this.branches.label(this.branchId()) ?? '');

  constructor() {
    void this.branches.ensureMine();
  }
}
