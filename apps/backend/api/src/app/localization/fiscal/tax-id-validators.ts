/**
 * Whether a taxpayer is a legal entity or a natural person — the one generic part of tax-identifier
 * validation. The check-digit functions themselves live with their market (`markets/<cc>/identity.ts`)
 * and are reached through the catalogue (`validateTaxId`, `resolveChecksum`).
 */
export { TaxpayerKind } from '../../markets';
// The Dominican identifier check, for the two consumers that still name it (the 606 purchase report
// and the supplier check of a Dominican bill). Both move into the Dominican package with the
// returns and purchases phases of docs/ARQUITECTURA_MERCADOS.md.
export { isValidDominicanTaxId } from '../../markets/do/identity';
