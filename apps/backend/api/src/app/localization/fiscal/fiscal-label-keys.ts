/**
 * Which of a market's human labels are translated, and which are not.
 *
 * Generic vocabulary is translated: "Provincia", "Código postal", "Tipo de ingreso" describe a kind of
 * field, and a reader needs those in their own language. A market's own terminology is not: `RNC`,
 * `CUIT`, `Ubigeo`, `Inscrição Estadual` are the names on the documents the user is copying from.
 *
 * Each market declares the key beside the label (`labelKey`, `helpKey`, `divisionLabelKey`…); this
 * module looks a label up across the catalogue for the consumers written against it.
 */
export { FISCAL_LABEL_KEYS, fiscalLabelKey } from '../../markets';
