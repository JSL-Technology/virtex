import { VxBulkBarComponent } from './bulk-bar.component';
import { VxTableComponent } from './table.component';
import { VxTableSelectAllComponent, VxTableSelectComponent } from './table-selection';

/** Everything a page needs for a table: `imports: [...VX_TABLE]`. */
export const VX_TABLE = [VxTableComponent, VxTableSelectAllComponent, VxTableSelectComponent, VxBulkBarComponent] as const;

export { VxTableComponent, VxTableSelectAllComponent, VxTableSelectComponent, VxBulkBarComponent };
export type { VxTableDensity, VxTableFrame, VxTableLayout } from './table.component';
export { applyRoles, cellGrid, columnLabels, headerText, labelCells, stickHeaderRows, AUTO_LABEL } from './table-dom';
