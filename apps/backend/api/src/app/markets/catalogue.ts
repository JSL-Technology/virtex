import type { MarketDefinition } from './contracts';
import { market as argentina } from './ar';
import { market as bolivia } from './bo';
import { market as brazil } from './br';
import { market as chile } from './cl';
import { market as colombia } from './co';
import { market as costaRica } from './cr';
import { market as dominicanRepublic } from './do';
import { market as ecuador } from './ec';
import { market as guatemala } from './gt';
import { market as honduras } from './hn';
import { market as mexico } from './mx';
import { market as nicaragua } from './ni';
import { market as panama } from './pa';
import { market as paraguay } from './py';
import { market as peru } from './pe';
import { market as elSalvador } from './sv';
import { market as unitedStates } from './us';
import { market as uruguay } from './uy';
import { market as venezuela } from './ve';

/**
 * Every market the product is sold in, in the order a country selector offers them.
 *
 * Opening a market is adding its package (`markets/<cc>/`, the same files as every other) and its
 * line here. Nothing else in the product names it. `market-structure.spec.ts` refuses a package
 * that is not listed and a listed package that is incomplete.
 */
export const MARKET_DEFINITIONS: readonly MarketDefinition[] = Object.freeze([
  dominicanRepublic,
  unitedStates,
  mexico,
  colombia,
  chile,
  peru,
  argentina,
  brazil,
  ecuador,
  uruguay,
  paraguay,
  bolivia,
  venezuela,
  panama,
  costaRica,
  guatemala,
  elSalvador,
  honduras,
  nicaragua,
]);
