import { EntityManager } from 'typeorm';
import type { FiscalReasonPurpose } from './entities/fiscal-reason-code.entity';

export interface FiscalReason {
  code: string;
  labelKey: string;
  legalBasis: string;
}

/**
 * The reasons a market's authority accepts for `purpose`, in force on `date` (FAC-INV-05). Empty
 * where the authority keeps no catalogue — a commercial void needs a reason in words, not a code.
 * Read by SQL: the catalogue is global reference data, shared through this contract.
 */
export async function fiscalReasonsOn(
  manager: EntityManager,
  countryCode: string | null | undefined,
  purpose: FiscalReasonPurpose,
  date: string,
): Promise<FiscalReason[]> {
  if (!countryCode) return [];
  const rows: Array<{ code: string; label_key: string; legal_basis: string }> = await manager.query(
    `SELECT "code", "label_key", "legal_basis" FROM "fiscal_reason_codes"
      WHERE "country_code" = $1 AND "purpose" = $2
        AND ("effective_from" IS NULL OR "effective_from" <= $3::date)
        AND ("effective_to" IS NULL OR "effective_to" >= $3::date)
      ORDER BY "code"`,
    [countryCode.toUpperCase(), purpose, date],
  );
  return rows.map((row) => ({ code: row.code, labelKey: row.label_key, legalBasis: row.legal_basis }));
}
