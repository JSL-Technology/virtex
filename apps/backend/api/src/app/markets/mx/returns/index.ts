import type { MarketReturnFiling } from '../../contracts';
import { catalogo } from './catalogo';
import { balanza } from './balanza';
import { polizas } from './polizas';

/**
 * Mexican electronic accounting: the three XML documents a taxpayer files with the SAT (Anexo 24 of
 * the Resolución Miscelánea Fiscal, versión 1.3).
 *
 * They are built, not sealed. The SAT requires the file to be signed with the taxpayer's FIEL and,
 * for the Balanza and the Catálogo, submitted through the Buzón Tributario; signing belongs with
 * the certificate handling the regimes already do, and pretending to have sealed an unsigned
 * document would be worse than producing an honest unsigned one the accountant can sign.
 */
export const MX_FILINGS: readonly MarketReturnFiling[] = [catalogo, balanza, polizas];

export { catalogo, balanza, polizas };
