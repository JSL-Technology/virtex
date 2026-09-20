import { VxDateFieldComponent } from './date-field.component';
import { VxDateRangeComponent } from './date-range.component';

export { VxDateFieldComponent, toCalendarDate } from './date-field.component';
export { VxDateRangeComponent } from './date-range.component';
export { dateOrder } from './date-range.validator';

export const VX_DATE = [VxDateFieldComponent, VxDateRangeComponent] as const;
