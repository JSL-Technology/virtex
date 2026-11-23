import { AgingQueryDto } from '../../shared/statements/aging-query.dto';

/**
 * The options of the report builder's receivables ageing: the cut-off and, optionally, one branch —
 * exactly those of `GET /customer-payments/aging`, because it is that report.
 *
 * It used to take a `ledgerId`, for an ageing of its own that answered 500 on the first open invoice
 * (IA-B02).
 */
export class AgingReportDto extends AgingQueryDto {}
