/**
 * Tax-identifier validation, as other modules may use it.
 *
 * The validators live in `fiscal/` with the rest of the country catalogue; this is the surface the
 * module offers, so a purchase can check its supplier's RNC without depending on how localization
 * organises its insides.
 */
export { isValidDominicanTaxId } from '../fiscal/tax-id-validators';
export { validateTaxId } from '../fiscal/identity-document-catalogue';
