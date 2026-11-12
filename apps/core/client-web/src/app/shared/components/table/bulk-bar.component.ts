import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslateModule, VxPluralKeyPipe } from '@virteex/shared/ui-i18n';
import { ListSelectionService } from '../context-menu/list-selection.service';

/**
 * What a selection can do, in sight: `<vx-bulk-bar>` inside `<vx-table>`, with the page's actions
 * projected. It shows only while something is selected, says how many, and clears the selection.
 *
 * ```html
 * <vx-table labelKey="…">
 *   <vx-bulk-bar>
 *     <button type="button" class="secondary-button" *appHasPermission="'products:edit'" (click)="archive()">…</button>
 *   </vx-bulk-bar>
 *   <table>…</table>
 * </vx-table>
 * ```
 *
 * The actions are the page's, behind the same permissions as each row's (a bar must never offer
 * what the row menu would refuse). The count is announced politely from a region that is always
 * there: a live region inserted together with its text is not reliably read.
 */
@Component({
  selector: 'vx-bulk-bar',
  standalone: true,
  imports: [TranslateModule, VxPluralKeyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="sr-only" role="status">{{ count() > 0 ? ('shell.table.selected' | vxPluralKey: count() | translate: { count: count() }) : '' }}</span>
    @if (count() > 0) {
      <div class="vx-bulk-bar" role="region" [attr.aria-label]="'actions.selection' | translate">
        <span class="vx-bulk-bar__count" aria-hidden="true">{{ 'shell.table.selected' | vxPluralKey: count() | translate: { count: count() } }}</span>
        <div class="vx-bulk-bar__actions"><ng-content /></div>
        <button type="button" class="link-button" (click)="selection.clear()">{{ 'actions.clear_selection' | translate }}</button>
      </div>
    }
  `,
})
export class VxBulkBarComponent {
  protected readonly selection = inject(ListSelectionService);
  protected readonly count = computed(() => this.selection.count());
}
