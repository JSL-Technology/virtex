/**
 * The authority's reason catalogues, as `fiscal_reason_codes` holds them for the date of a document
 * (audit 2026-11-07, FAC-INV-05). Which catalogue a cancellation needs is the market's policy
 * (`markets/<cc>/documents.ts`, read through `cancellationRouteFor`); the codes in force on a date
 * are rows, with their legal basis and validity, read here.
 */
export { fiscalReasonsOn, type FiscalReason } from '../fiscal/fiscal-reason-codes';
