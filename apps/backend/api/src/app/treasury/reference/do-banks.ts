import type { BankKind } from '../entities/bank.entity';

/**
 * An institution as a national regulator lists it, ready to become a tenant's catalogue entry.
 *
 * Only what an official source confirms is filled in. A field left `null` is a fact nobody
 * official vouches for, not a gap to fill from a directory site: a wrong BIC routes a payment to
 * someone else, while a blank one only asks the user to type it.
 */
export interface ReferenceBank {
  /** The name people use («Banco Popular»): what the catalogue shows and is unique on. */
  name: string;
  /** The registered name («Banco Popular Dominicano, S. A. - Banco Múltiple»). */
  legalName: string;
  kind: BankKind;
  /** Only a BIC connected to SWIFT and confirmed by the regulator or the central bank. */
  swiftBic: string | null;
  /** The participant code the central bank publishes for its payment systems. */
  localCode: string | null;
  /** The taxpayer number, digits only. */
  taxId: string | null;
  /** Where each fact was confirmed; the regulator's own page first. */
  sources: readonly string[];
}

/**
 * Financial intermediaries operating in the Dominican Republic.
 *
 * ## Source and rules
 *
 * The universe is every entity listed as «Operando» by the Superintendencia de Bancos
 * (sb.gob.do/supervisados/entidades-de-intermediacion-financiera), consulted on 2026-11-01: 16
 * multiple banks, 14 savings and credit banks, 10 savings and loan associations and 3 credit
 * corporations. The two public entities (Banco Agrícola, Bandex) are out: they are not
 * intermediaries a company holds an operating account at.
 *
 * - **Name, legal name and RNC** come from each entity's SB page, spelled as published there.
 *   The RNC is null where that page did not give it.
 * - **SWIFT/BIC** only when the SB or the Banco Central confirms it and it is connected to the
 *   network. A passive BIC (8th character `1`) is not one: it cannot receive an MT103.
 * - **Local code** is the participant identifier the Banco Central publishes for SIPARD (LBTR and
 *   direct debits and credits). In the Dominican Republic that identifier is the 11-character BIC
 *   itself; there is no separate numeric routing code.
 * - Where third-party directories disagree on a BIC and nothing official settles it, it is left
 *   empty, with the disagreement noted beside the entry.
 */
export const DOMINICAN_BANKS: readonly ReferenceBank[] = [
  {
    name: 'Banreservas',
    legalName: 'Banco de Reservas de la República Dominicana - Banco Múltiple, S. A.',
    kind: 'multiple_bank',
    swiftBic: 'BRRDDOSD',
    localCode: 'BRRDDOSDXXX',
    taxId: '401010062',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banreservas/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Banco Ademi',
    legalName: 'Banco Múltiple Ademi, S. A.',
    kind: 'multiple_bank',
    swiftBic: 'AHCMDOSD',
    localCode: 'AHCMDOSDXXX',
    taxId: '101745274',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-ademi/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Banco BDI',
    legalName: 'Banco Multiple BDI, S. A.',
    kind: 'multiple_bank',
    swiftBic: 'BBDIDOSD',
    localCode: 'BBDIDOSDXXX',
    taxId: '101040297',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-bdi/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Banco BHD',
    legalName: 'Banco Múltiple BHD, S. A.',
    kind: 'multiple_bank',
    swiftBic: 'BCBHDOSD',
    localCode: 'BCBHDOSDXXX',
    taxId: null,
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-bhd', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf', 'https://wise.com/es/swift-codes/BCBHDOSDXXX'],
  },
  {
    name: 'Banco Caribe',
    legalName: 'Banco Multiple Caribe Internacional, S. A.',
    kind: 'multiple_bank',
    swiftBic: 'STGODOSD',
    localCode: 'STGODOSDXXX',
    taxId: '102341257',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-caribe/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'JMMB Bank',
    legalName: 'BANCO MÚLTIPLE JMMB BANK, S. A.',
    kind: 'multiple_bank',
    swiftBic: 'AHRIDOS2',
    localCode: 'AHRIDOS2XXX',
    taxId: '101118431',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/jmmb-bank/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Banco Lafise',
    legalName: 'Banco Múltiple Lafise, S. A.',
    kind: 'multiple_bank',
    swiftBic: 'BCCEDOSD',
    localCode: 'BCCEDOSDXXX',
    taxId: '130826481',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-lafise/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Banco López de Haro',
    legalName: 'Banco Múltiple López de Haro, S. A.',
    kind: 'multiple_bank',
    swiftBic: 'BLDHDOSD',
    localCode: 'BLDHDOSDXXX',
    taxId: '101145889',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-lopez-de-haro/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Banco Promerica',
    legalName: 'Banco Múltiple Promerica de la República Dominicana, S. A.',
    kind: 'multiple_bank',
    swiftBic: 'PRHRDOSD',
    localCode: 'PRHRDOSDXXX',
    taxId: '101844523',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-promerica/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Banco Santa Cruz',
    legalName: 'Banco Múltiple Santa Cruz, S. A.',
    kind: 'multiple_bank',
    swiftBic: 'SCRZDOSD',
    localCode: 'SCRZDOSDXXX',
    taxId: '102012921',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-santa-cruz', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Banco Vimenca',
    legalName: 'Banco Múltiple Vimenca, S. A.',
    kind: 'multiple_bank',
    swiftBic: 'VIMEDOSD',
    localCode: 'VIMEDOSDXXX',
    taxId: '101021411',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-vimenca/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Banco Popular',
    legalName: 'Banco Popular Dominicano, S. A. - Banco Múltiple',
    kind: 'multiple_bank',
    swiftBic: 'BPDODOSX',
    localCode: 'BPDODOSXXXX',
    taxId: '101010632',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-popular', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf', 'https://wise.com/es/swift-codes/BPDODOSXXXX'],
  },
  {
    name: 'Banesco',
    legalName: 'BANESCO BANCO MÚLTIPLE, S.A.',
    kind: 'multiple_bank',
    swiftBic: 'BANSDOSD',
    localCode: 'BANSDOSDXXX',
    taxId: null,
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banesco', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Citibank',
    legalName: 'CITIBANK, N. A.',
    kind: 'multiple_bank',
    swiftBic: 'CITIDOSD',
    localCode: 'CITIDOSDXXX',
    taxId: null,
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/citibank/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Qik Banco Digital',
    legalName: 'QIK BANCO DIGITAL DOMINICANO, S. A., BANCO MULTIPLE',
    kind: 'multiple_bank',
    swiftBic: 'QDDMDOSD',
    localCode: 'QDDMDOSDXXX',
    taxId: '132498412',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/qik-banco-digital/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Scotiabank',
    legalName: 'Scotiabank República Dominicana, S. A. - Banco Múltiple',
    kind: 'multiple_bank',
    swiftBic: 'NOSCDOSD',
    localCode: 'NOSCDOSDXXX',
    taxId: '101043598',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/scotiabank/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://aba.org.do/articulos-perspectivas/codigos-swift-bancos-rd/', 'https://banguat.gob.gt/sites/default/files/banguat/Publica/SPagos/Participantes_SIPA.pdf'],
  },
  {
    name: 'Banco Atlántico',
    legalName: 'BANCO ATLANTICO DE AHORRO Y CRÉDITO , S.A.',
    kind: 'savings_credit_bank',
    swiftBic: 'BAACDOSD',
    localCode: 'BAACDOSDXXX',
    taxId: null,
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-atlantico/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Banco BACC',
    legalName: 'Banco Bacc de Ahorro y Crédito del Caribe, S. A.',
    kind: 'savings_credit_bank',
    swiftBic: null,
    localCode: null,
    taxId: '101138793',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-bacc/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Banco Adopem',
    legalName: 'Banco de Ahorro y Crédito Adopem, S. A.',
    kind: 'savings_credit_bank',
    swiftBic: null,
    localCode: null,
    taxId: '103003109',
    // BIC en conflicto, no cargado: wise.com, xe.com y ohmyfin.ai dan AHCDDOS2XXX; remitfinder.com y wewire.com dan AHCDDOS1XXX. Ninguna fuente oficial.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-adopem/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://wise.com/us/swift-codes/AHCDDOS2XXX', 'https://www.xe.com/swift-codes/AHCDDOS2XXX/', 'https://ohmyfin.ai/country/dominican-republic', 'https://www.remitfinder.com/bank-code/swift-code/dominican-republic/AHCDDOS1XXX', 'https://www.wewire.com/swift-code-checker/dominican-republic/ahcddos1'],
  },
  {
    name: 'Bancotui',
    legalName: 'Banco de Ahorro y Crédito Bancotui, S. A.',
    kind: 'savings_credit_bank',
    swiftBic: null,
    localCode: null,
    taxId: '104002008',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/bancotui/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc'],
  },
  {
    name: 'Banco Cofaci',
    legalName: 'Banco de Ahorro Y Crédito Cofaci, S. A.',
    kind: 'savings_credit_bank',
    swiftBic: null,
    localCode: null,
    taxId: '101147288',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-cofaci/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Banco Confisa',
    legalName: 'Banco de Ahorro y Crédito Confisa, S. A.',
    kind: 'savings_credit_bank',
    swiftBic: null,
    localCode: null,
    taxId: '101090091',
    // BIC en conflicto, no cargado: theswiftcodes.com y ohmyfin.ai dan AHCODOSM(XXX); bank-code.net da AHCODOS1XXX. Ninguna fuente oficial.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-confisa/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://www.theswiftcodes.com/dominican-republic/ahcodosm/', 'https://ohmyfin.ai/country/dominican-republic', 'https://bank-code.net/swift-code/AHCODOS1XXX.html'],
  },
  {
    name: 'Banco Fihogar',
    legalName: 'Banco de Ahorro y Crédito Fihogar, S. A.',
    kind: 'savings_credit_bank',
    swiftBic: null,
    localCode: null,
    taxId: '101205679',
    // BIC en conflicto, no cargado: theswiftcodes.com y ohmyfin.ai dan AHCGDOS3(XXX); remitly.com da AHCGDOS1XXX. Ninguna fuente oficial.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-fihogar/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://www.theswiftcodes.com/dominican-republic/ahcgdos3/', 'https://ohmyfin.ai/country/dominican-republic', 'https://www.remitly.com/be/en/swift-codes/dominican-republic/ahcgdos1xxx/banco-de-ahorro-y-credito-fihogar'],
  },
  {
    name: 'Banfondesa',
    legalName: 'Banco de Ahorro y Crédito Fondesa, S. A. (Banfondesa)',
    kind: 'savings_credit_bank',
    swiftBic: 'ACFEDOSC',
    localCode: 'ACFEDOSCXXX',
    taxId: '131134874',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banfondesa/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Banco Gruficorp',
    legalName: 'Banco de Ahorro y Crédito Gruficorp, S. A.',
    kind: 'savings_credit_bank',
    swiftBic: null,
    localCode: null,
    taxId: '101110694',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-gruficorp/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Banco Unión',
    legalName: 'Banco de Ahorro y Crédito Unión, S. A.',
    kind: 'savings_credit_bank',
    swiftBic: 'UNONDOSD',
    localCode: 'UNONDOSDXXX',
    taxId: '124031621',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-union/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Banco Óptima',
    legalName: 'BANCO ÓPTIMA DE AHORRO Y CRÉDITO, S. A.',
    kind: 'savings_credit_bank',
    swiftBic: null,
    localCode: null,
    taxId: '130463107',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/banco-optima-de-ahorro-y-credito/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc'],
  },
  {
    name: 'Bonanza',
    legalName: 'Bonanza Banco de Ahorro y Crédito, S. A.',
    kind: 'savings_credit_bank',
    swiftBic: null,
    localCode: null,
    taxId: '101106174',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/bonanza/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc'],
  },
  {
    name: 'Leasing Confisa',
    legalName: 'LEASING CONFISA, BANCO DE AHORRO Y CREDITO, S. A.',
    kind: 'savings_credit_bank',
    swiftBic: null,
    localCode: null,
    taxId: '101150653',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/leasing-confisa/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc'],
  },
  {
    name: 'Motor Crédito',
    legalName: 'Motor Crédito, S. A. Banco de Ahorro y Crédito',
    kind: 'savings_credit_bank',
    swiftBic: null,
    localCode: null,
    taxId: '101028289',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/motor-credito/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc'],
  },
  {
    name: 'ABONAP',
    legalName: 'Asociación Bonao de Ahorros y Préstamos',
    kind: 'savings_loan_association',
    swiftBic: 'ABHRDOSD',
    localCode: 'ABHRDOSDXXX',
    taxId: '403001379',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/abonap/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/cevaldom.pdf?v=1761177600173', 'https://wise.com/es/swift-codes/ABHRDOSDXXX', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Asociación Cibao',
    legalName: 'Asociación Cibao de Ahorros y Préstamos',
    kind: 'savings_loan_association',
    swiftBic: 'ACIBDOSX',
    localCode: 'ACIBDOSXXXX',
    taxId: null,
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/asociacion-cibao/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Asociación Duarte',
    legalName: 'Asociación Duarte de Ahorros y Préstamos',
    kind: 'savings_loan_association',
    swiftBic: null,
    localCode: 'ADUADOS1XXX',
    taxId: '404000512',
    // BIC pasivo, no conectado a SWIFT: solo el código de participante del BCRD.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/asociacion-duarte/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/sab.pdf?v=1774915200144', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Asociación La Nacional',
    legalName: 'Asociación La Nacional de Ahorros Y Préstamos',
    kind: 'savings_loan_association',
    swiftBic: 'ANAYDOSD',
    localCode: 'ANAYDOSDXXX',
    taxId: '101013524',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/asociacion-la-nacional/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Alaver',
    legalName: 'Asociación La Vega Real de Ahorros y Préstamos',
    kind: 'savings_loan_association',
    swiftBic: 'ALVRDOS2',
    localCode: 'ALVRDOS2XXX',
    taxId: '403000631',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/alaver/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/sab.pdf?v=1774915200144', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Asociación Maguana',
    legalName: 'Asociación Maguana de Ahorros y Préstamos',
    kind: 'savings_loan_association',
    swiftBic: null,
    localCode: null,
    taxId: '418000408',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/asociacion-maguana/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Asociación Mocana',
    legalName: 'Asociación Mocana de Ahorros y Préstamos',
    kind: 'savings_loan_association',
    swiftBic: 'AMARDOS2',
    localCode: 'AMARDOS2XXX',
    taxId: '406000052',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/asociacion-mocana/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/cevaldom.pdf?v=1761177600173', 'https://wise.com/es/swift-codes/AMARDOS2XXX', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Asociación Peravia',
    legalName: 'Asociación Peravia de Ahorros y Préstamos',
    kind: 'savings_loan_association',
    swiftBic: null,
    localCode: 'APARDOS1XXX',
    taxId: '415000175',
    // BIC pasivo, no conectado a SWIFT: solo el código de participante del BCRD.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/asociacion-peravia/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://sb.gob.do/entidades-autorizadas-sib/entidades/PERAVIA', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/cevaldom.pdf?v=1761177600173', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Asociación Popular (APAP)',
    legalName: 'Asociación Popular de Ahorros y Préstamos',
    kind: 'savings_loan_association',
    swiftBic: 'APOPDOSX',
    localCode: 'APOPDOSXXXX',
    taxId: '401000131',
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/asociacion-popular/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://cdn.bancentral.gov.do/documents/sistema-de-pagos/informacion-general/documents/deb_cred_directos_cardnet.pdf?v=1656892800075', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Asociación Romana',
    legalName: 'Asociación Romana de Ahorros y Préstamos',
    kind: 'savings_loan_association',
    swiftBic: null,
    localCode: null,
    taxId: '412000169',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/asociacion-romana/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc', 'https://ohmyfin.ai/country/dominican-republic'],
  },
  {
    name: 'Monumental',
    legalName: 'Corporación de Crédito Monumental, S. A.',
    kind: 'credit_corporation',
    swiftBic: null,
    localCode: null,
    taxId: '102016909',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/corporacion-de-credito-monumental/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc'],
  },
  {
    name: 'Nordestana',
    legalName: 'Corporación de Crédito Nordestana de Préstamos, S. A.',
    kind: 'credit_corporation',
    swiftBic: null,
    localCode: null,
    taxId: '104000684',
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/corporacion-de-credito-nordestana/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc'],
  },
  {
    name: 'Oficorp',
    legalName: 'Corporación de Crédito Oficorp',
    kind: 'credit_corporation',
    swiftBic: null,
    localCode: null,
    taxId: null,
    // Sin BIC ni código de participante en fuente oficial: se dejan vacíos.
    sources: ['https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/corporacion-de-credito-oficorp/', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?sort=Nombre%20asc', 'https://sb.gob.do/supervisados/entidades-de-intermediacion-financiera/?page=2&sort=Nombre%20asc'],
  },
];
