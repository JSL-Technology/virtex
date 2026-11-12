import { DataSource } from 'typeorm';
import { fiscalIdentifierFor, knownMarket } from '../../markets';

/**
 * The sample row of a customer or supplier template, filled from the company's own market.
 *
 * A template is the first thing a person sees of the import, and it teaches by example: whatever
 * is in the sample row is what they copy their file's shape from. The columns were constants, so
 * every market downloaded the same Dominican one — `RNC` as the document type, a `131-12345-7`
 * tax id, `DO` as the country and a Santo Domingo address — and a Mexican company was being shown
 * an identifier its own authority does not issue, for a country it does not operate in.
 *
 * What a market can answer, the market answers: its fiscal identifier's code and the example its
 * own catalogue declares for it (`markets/<cc>/identity.ts`), its country, its calling code. The
 * rest of the row — a company name, a street, a contact — is deliberately a neutral placeholder in
 * the column's `example`: those are not facts about a market, and inventing a local address for
 * nineteen of them would only move the problem.
 */
export async function partyTemplateExample(
  dataSource: DataSource,
  organizationId: string,
): Promise<Record<string, string>> {
  const [organization] = await dataSource.query<Array<{ country: string | null }>>(
    `SELECT "country" FROM "organizations" WHERE "id" = $1`,
    [organizationId],
  );
  const country = (organization?.country ?? '').trim().toUpperCase();
  const market = knownMarket(country);
  if (!market) return {};

  const example: Record<string, string> = { country: market.code, identityDocumentCountry: market.code };
  const identifier = fiscalIdentifierFor(market.code);
  if (identifier) {
    example['identityDocumentTypeCode'] = identifier.code;
    if (identifier.example) example['taxId'] = identifier.example;
  }
  if (market.profile.callingCode) example['phone'] = `+${market.profile.callingCode} 000 000 0000`;
  return example;
}
