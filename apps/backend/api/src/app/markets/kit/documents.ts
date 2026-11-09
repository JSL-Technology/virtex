import type { CancellationRoute } from '../contracts';

export const VOID: CancellationRoute = { kind: 'VOID' };
export const REPORT_IN_RETURN: CancellationRoute = { kind: 'REPORT', reasonCatalogue: 'INVOICE_CANCELLATION' };
export const CREDIT_NOTE_ONLY: CancellationRoute = { kind: 'CREDIT_NOTE_ONLY' };
export const AUTHORITY_EVENT: CancellationRoute = { kind: 'AUTHORITY_EVENT', implemented: false };
