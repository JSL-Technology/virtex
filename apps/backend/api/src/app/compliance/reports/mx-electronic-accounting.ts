import * as xmlbuilder from 'xmlbuilder';
import { EntityManager } from 'typeorm';
import { Account, AccountType } from '../../chart-of-accounts/entities/account.entity';
import { AccountNature } from '../../chart-of-accounts/enums/account-enums';
import {
  JournalEntry,
  JournalEntryStatus,
} from '../../journal-entries/entities/journal-entry.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import {
  AccountBalancesService,
  toIsoDate,
} from '../../chart-of-accounts/account-balances.service';
import { roundAmount } from '../../common/money';
import { BadRequestError } from '../../i18n/localized.exception';

/**
 * Mexican electronic accounting: the three XML files a taxpayer files with the SAT.
 *
 * ## Why this was the piece to build
 *
 * The audit's words: the hard part was done and the easy part was not. `NumUnIdenPol` — the
 * unique identifier of a journal entry within its journal and its fiscal year — is the requirement
 * that usually forces a rewrite of a ledger's numbering, and this product already produces exactly
 * that: a gap-free consecutive per journal per fiscal year, allocated inside the posting
 * transaction from a counter row. What did not exist was the serialisation.
 *
 * Three documents, defined by Anexo 24 of the Resolución Miscelánea Fiscal, version 1.3:
 *
 * - **Catálogo de cuentas** — the taxpayer's chart, each account mapped onto a code from the SAT's
 *   published grouping list. Filed once and again whenever the chart changes.
 * - **Balanza de comprobación** — opening balance, period debits and credits, closing balance, per
 *   account. Filed monthly.
 * - **Pólizas del periodo** — every entry of the period with its lines. Filed on request, when the
 *   authority audits, refunds or offsets.
 *
 * ## What this does not do, said plainly
 *
 * It builds the XML. It does not seal it: the SAT requires the file to be signed with the
 * taxpayer's FIEL and, for the Balanza and the Catálogo, submitted through the Buzón Tributario.
 * Signing belongs with the certificate handling that `einvoicing/` already does for the Dominican
 * regime, and pretending to have sealed a document that is unsigned would be worse than producing
 * an honest unsigned one the taxpayer's accountant can sign.
 *
 * Amounts carry two decimals, dates are `AAAA-MM-DD`, and every figure comes from the ledger
 * through `AccountBalancesService` — the same source the balance sheet reads, so the file and the
 * statements cannot disagree.
 */
export interface MexicanAccountingPeriod {
  organizationId: string;
  /** Four digits. */
  year: number;
  /** 1–12. The SAT writes it zero-padded; that is done here. */
  month: number;
  ledgerId?: string;
}

/** `TipoSolicitud` on the Pólizas file: which procedure the authority is running. */
export type PolizasRequestType = 'AF' | 'FC' | 'DE' | 'CO';

export class MexicanElectronicAccounting {
  constructor(
    private readonly manager: EntityManager,
    private readonly balances: AccountBalancesService,
  ) {}

  // ── Catálogo de cuentas ────────────────────────────────────────────────────

  /**
   * The taxpayer's chart of accounts, mapped onto the SAT's grouping codes.
   *
   * An account with no grouping code cannot be filed — the taxpayer's own numbering says nothing
   * to the authority — so the absence is refused by name rather than emitted as an empty
   * attribute the SAT would reject on upload.
   */
  async catalogo(period: MexicanAccountingPeriod): Promise<string> {
    const { rfc } = await this.taxpayer(period.organizationId);
    const accounts = await this.manager.find(Account, {
      where: { organizationId: period.organizationId },
      order: { code: 'ASC' },
    });

    const missing = accounts.filter((account) => !account.fiscalGroupingCode?.trim());
    if (missing.length > 0) {
      throw new BadRequestError('COMPLIANCE.CUENTAS_SIN_CODIGO_AGRUPADOR_SAT', {
        count: missing.length,
        example: missing[0].code,
      });
    }

    const root = xmlbuilder
      .create('catalogocuentas:Catalogo', { encoding: 'UTF-8' })
      .att('xmlns:catalogocuentas', CATALOGO_NS)
      .att('xmlns:xsi', XSI_NS)
      .att('xsi:schemaLocation', `${CATALOGO_NS} ${CATALOGO_NS}/CatalogoCuentas_1_3.xsd`)
      .att('Version', '1.3')
      .att('RFC', rfc)
      .att('Mes', pad2(period.month))
      .att('Anio', String(period.year));

    for (const account of accounts) {
      const node = root
        .ele('catalogocuentas:Ctas')
        .att('CodAgrup', account.fiscalGroupingCode!.trim())
        .att('NumCta', account.code)
        .att('Desc', describe(account))
        .att('Nivel', String(levelOf(account.code)))
        .att('Natur', natureOf(account));

      // `SubCtaDe` names the parent account by ITS OWN number, which is what makes the file a
      // tree rather than a list. Derived from the code's own segments so it cannot disagree with
      // the hierarchy the product shows.
      const parent = parentCodeOf(account.code);
      if (parent) node.att('SubCtaDe', parent);
    }

    return root.end({ pretty: true });
  }

  // ── Balanza de comprobación ────────────────────────────────────────────────

  /**
   * Opening balance, the period's movement, and closing balance, per account.
   *
   * `TipoEnvio` is `N` for the ordinary monthly filing and `C` for a complementary one that
   * corrects it; the caller says which, because only the taxpayer knows whether they are
   * correcting something already filed.
   */
  async balanza(
    period: MexicanAccountingPeriod,
    options: { tipoEnvio?: 'N' | 'C'; fechaModBal?: string } = {},
  ): Promise<string> {
    const { rfc } = await this.taxpayer(period.organizationId);
    const ledgerId = await this.resolveLedger(period);
    const { from, to } = monthRange(period.year, period.month);

    const accounts = await this.manager.find(Account, {
      where: { organizationId: period.organizationId },
      order: { code: 'ASC' },
    });

    const scope = { organizationId: period.organizationId, ledgerId };
    const rows = await this.balances.trialBalance(
      { ...scope, from, to },
      this.manager,
    );
    const byAccount = new Map(rows.map((row) => [row.accountId, row]));

    const root = xmlbuilder
      .create('BCE:Balanza', { encoding: 'UTF-8' })
      .att('xmlns:BCE', BALANZA_NS)
      .att('xmlns:xsi', XSI_NS)
      .att('xsi:schemaLocation', `${BALANZA_NS} ${BALANZA_NS}/BalanzaComprobacion_1_3.xsd`)
      .att('Version', '1.3')
      .att('RFC', rfc)
      .att('Mes', pad2(period.month))
      .att('Anio', String(period.year))
      .att('TipoEnvio', options.tipoEnvio ?? 'N');

    // Only required on a complementary filing, and only then: the SAT rejects it on an ordinary
    // one. Which is why it is not simply always written.
    if ((options.tipoEnvio ?? 'N') === 'C' && options.fechaModBal) {
      root.att('FechaModBal', options.fechaModBal);
    }

    for (const account of accounts) {
      const row = byAccount.get(account.id);
      const opening = row?.openingBalance ?? 0;
      const debit = row?.debit ?? 0;
      const credit = row?.credit ?? 0;
      const closing = row?.closingBalance ?? 0;

      // An account that neither carries a balance nor moved is not part of the month's balanza.
      // Filing every account in the chart with four zeroes is a larger file that says less.
      if (
        cents(opening) === 0 &&
        cents(debit) === 0 &&
        cents(credit) === 0 &&
        cents(closing) === 0
      ) {
        continue;
      }

      root
        .ele('BCE:Ctas')
        .att('NumCta', account.code)
        // The SAT states balances in the account's own natural sense — a positive figure for a
        // liability means it is owed — while the ledger stores them signed `debit − credit`. The
        // conversion happens here, once, rather than at each of the four attributes.
        .att('SaldoIni', money(naturalise(account, opening)))
        .att('Debe', money(debit))
        .att('Haber', money(credit))
        .att('SaldoFin', money(naturalise(account, closing)));
    }

    return root.end({ pretty: true });
  }

  // ── Pólizas del periodo ────────────────────────────────────────────────────

  /**
   * Every entry posted in the period, with its lines.
   *
   * `NumUnIdenPol` is the entry's own number — gap-free, per journal, per fiscal year — which is
   * the requirement this ledger already satisfied before the file existed. An entry with no number
   * has not been posted and is not part of the filing.
   */
  async polizas(
    period: MexicanAccountingPeriod,
    options: { tipoSolicitud?: PolizasRequestType; numOrden?: string; numTramite?: string } = {},
  ): Promise<string> {
    const { rfc } = await this.taxpayer(period.organizationId);
    const ledgerId = await this.resolveLedger(period);
    const { from, to } = monthRange(period.year, period.month);

    const entries = await this.manager
      .createQueryBuilder(JournalEntry, 'entry')
      .innerJoinAndSelect('entry.lines', 'line')
      .innerJoinAndSelect('line.valuations', 'valuation', 'valuation.ledgerId = :ledgerId', {
        ledgerId,
      })
      .innerJoinAndSelect('line.account', 'account')
      .where('entry.organizationId = :organizationId', {
        organizationId: period.organizationId,
      })
      .andWhere('entry.status = :status', { status: JournalEntryStatus.POSTED })
      .andWhere('entry.date BETWEEN :from AND :to', { from, to })
      .orderBy('entry.date', 'ASC')
      .addOrderBy('entry.entryNumber', 'ASC')
      .getMany();

    const tipoSolicitud = options.tipoSolicitud ?? 'AF';
    const root = xmlbuilder
      .create('PLZ:Polizas', { encoding: 'UTF-8' })
      .att('xmlns:PLZ', POLIZAS_NS)
      .att('xmlns:xsi', XSI_NS)
      .att('xsi:schemaLocation', `${POLIZAS_NS} ${POLIZAS_NS}/PolizasPeriodo_1_3.xsd`)
      .att('Version', '1.3')
      .att('RFC', rfc)
      .att('Mes', pad2(period.month))
      .att('Anio', String(period.year))
      .att('TipoSolicitud', tipoSolicitud);

    // `NumOrden` belongs to an audit (AF) or a certification (CO); `NumTramite` to a refund (DE)
    // or an offset (FC). Writing the wrong one, or both, is a rejected upload.
    if (options.numOrden && (tipoSolicitud === 'AF' || tipoSolicitud === 'CO')) {
      root.att('NumOrden', options.numOrden);
    }
    if (options.numTramite && (tipoSolicitud === 'DE' || tipoSolicitud === 'FC')) {
      root.att('NumTramite', options.numTramite);
    }

    for (const entry of entries) {
      if (!entry.entryNumber) continue;

      const poliza = root
        .ele('PLZ:Poliza')
        .att('NumUnIdenPol', entry.entryNumber)
        .att('Fecha', toIsoDate(entry.date))
        .att('Concepto', entry.description ?? entry.entryNumber);

      for (const line of entry.lines) {
        const valuation = line.valuations?.[0];
        if (!valuation) continue;

        poliza
          .ele('PLZ:Transaccion')
          .att('NumCta', line.account?.code ?? '')
          .att('DesCta', line.account ? describe(line.account) : '')
          .att('Concepto', line.description ?? entry.description ?? '')
          .att('Debe', money(valuation.debit))
          .att('Haber', money(valuation.credit));
      }
    }

    return root.end({ pretty: true });
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /**
   * The taxpayer's RFC.
   *
   * Refused by name when absent rather than written as an empty attribute: a file whose RFC is
   * blank is rejected on upload, and discovering that at the Buzón Tributario on the deadline is a
   * worse way to learn it than being told here.
   */
  private async taxpayer(organizationId: string): Promise<{ rfc: string }> {
    const organization = await this.manager.findOne(Organization, {
      where: { id: organizationId },
      select: ['id', 'taxId', 'country'],
    });
    const rfc = organization?.taxId?.trim().toUpperCase();
    if (!rfc) {
      throw new BadRequestError('COMPLIANCE.ORGANIZACION_SIN_RFC');
    }
    return { rfc };
  }

  private async resolveLedger(period: MexicanAccountingPeriod): Promise<string> {
    if (period.ledgerId) return period.ledgerId;
    const ledger = await this.manager.findOneBy(Ledger, {
      organizationId: period.organizationId,
      isDefault: true,
    });
    if (!ledger) throw new BadRequestError('COMPLIANCE.SIN_LIBRO_CONTABLE_POR_DEFECTO');
    return ledger.id;
  }
}

const CATALOGO_NS = 'http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas';
const BALANZA_NS = 'http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion';
const POLIZAS_NS = 'http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/PolizasPeriodo';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Two decimals, dot separator, no thousands separator — the format the schema declares. */
function money(value: number): string {
  return roundAmount(value).toFixed(2);
}

function cents(value: number): number {
  return Math.round(value * 100);
}

/**
 * The account's name in the reader's terms.
 *
 * `name` is a translated map in this product; the SAT wants one string. Spanish is taken where it
 * exists, since the filing is Mexican, and the first available translation otherwise.
 */
function describe(account: Account): string {
  const name = account.name as unknown;
  if (typeof name === 'string') return name;
  const map = (name ?? {}) as Record<string, string>;
  return map['es'] ?? Object.values(map)[0] ?? account.code;
}

/**
 * `Natur`: `D` for an account whose increases are debits, `A` for one whose increases are credits.
 *
 * Taken from the account's declared nature, falling back to its type — an asset or expense is a
 * debit account, everything else a credit one — because the nature column is the tenant's
 * statement and the type is the structural fact behind it.
 */
function natureOf(account: Account): 'D' | 'A' {
  if (account.nature === AccountNature.DEBIT) return 'D';
  if (account.nature === AccountNature.CREDIT) return 'A';
  return account.type === AccountType.ASSET || account.type === AccountType.EXPENSE ? 'D' : 'A';
}

/**
 * A balance in the account's own natural sense.
 *
 * The ledger stores every balance signed `debit − credit`, so a liability with 5,000 owed is
 * −5,000. The SAT states it as 5,000. Flipped once, here, rather than at each of the attributes
 * that need it.
 */
function naturalise(account: Account, signedBalance: number): number {
  return natureOf(account) === 'D' ? signedBalance : -signedBalance;
}

/** How deep the account sits, counting the dot-separated segments of its code. */
function levelOf(code: string): number {
  return code.split(/[.\-]/).filter(Boolean).length;
}

/** The parent's own number, or null at the top level. */
function parentCodeOf(code: string): string | null {
  const separator = code.includes('.') ? '.' : code.includes('-') ? '-' : null;
  if (!separator) return null;
  const segments = code.split(separator).filter(Boolean);
  if (segments.length <= 1) return null;
  return segments.slice(0, -1).join(separator);
}

/** First and last day of the month, as `YYYY-MM-DD`. */
function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${year}-${pad2(month)}-${pad2(lastDay)}` };
}
