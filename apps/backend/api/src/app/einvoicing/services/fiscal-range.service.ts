import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  FiscalDocumentRange,
  FiscalRangeSecretKind,
} from '../entities/fiscal-document-range.entity';
import { CertificateVaultService } from './certificate-vault.service';
import { BadRequestError, ConflictError, InternalServerError, NotFoundError } from '../../i18n/localized.exception';
import { IssuedFiscalNumbersRegistry } from '../../contracts/fiscal-records/issued-fiscal-numbers.registry';
import { fiscalAuthorityOf, knownMarket, type SeriesSelector } from '../../markets';

/** A number drawn from an authorised range, with the authorisation it came from. */
export interface DrawnFiscalNumber {
  /** The bare number, before the market formats it. */
  number: number;
  /** The range's own series, so the caller can format `F001-00000123` or `001-001-000000123`. */
  series: string;
  /** The document type the range authorises. */
  documentType: string;
  /** When the authorisation expires, or null where the market does not time-box it. */
  validUntil: string | null;
  /** The administrative act that granted the range. */
  authorizationCode: string | null;
  /** The range's decrypted secret, materialised only when the caller asks for it. */
  secret: string | null;
  secretKind: FiscalRangeSecretKind | null;
}

/** What registering a range the authority granted takes. */
export interface FiscalRangeRegistration {
  organizationId: string;
  countryCode: string;
  documentType: string;
  /** `''` or absent where the market numbers without a series. */
  series?: string;
  startsAt: number;
  endsAt: number;
  validUntil?: string | null;
  authorizationCode?: string | null;
  secret?: string | null;
  secretKind?: FiscalRangeSecretKind | null;
  /** The tenant's fiscal date, `YYYY-MM-DD`: an authorisation that lapsed yesterday there is refused. */
  today: string;
}

/** Which active range: of a type, and of a series where the market numbers per series. */
export interface FiscalRangeCriteria {
  organizationId: string;
  countryCode: string;
  documentType: string;
  /** An exact series, or a prefix it must begin with. Absent: the company's active range of the type. */
  series?: string | SeriesSelector;
}

/** Below this many numbers left, or this share of the range, a range is running low. */
const LOW_WATERMARK_ABSOLUTE = 50;
const LOW_WATERMARK_FRACTION = 0.1;

/**
 * The tenant's authorised number ranges, for every market that numbers from one — the one place a
 * fiscal number is drawn, a range registered, retired or reactivated, and a stretch closed.
 *
 * ## One table, one set of rules
 *
 * The Dominican Republic had its own table and service (`ncf_sequences`, `ComplianceService`), and
 * the strict rules lived only there: a range overlapping one registered before was refused, and one
 * whose numbers were already on documents. Every other market's ranges, here, were checked for
 * nothing but their bounds — so re-entering a Peruvian or Colombian range reset its counter and
 * handed out numbers already printed on customers' invoices. The rules are now the same for every
 * market, and what differs — whether the type exists, whether its ranges expire, which series it
 * may carry — is read from the market's own package (`markets/<cc>/documents.ts`).
 *
 * ## The lock is the whole point
 *
 * `SELECT … FOR UPDATE` inside the caller's transaction. Without it, two issuances that read the
 * counter before either writes it both get the same number: the authority accepts the first
 * document and rejects the second, and the taxpayer is left explaining a duplicate to an inspector.
 * A fiscal number is not a display value — it is the identity the authority indexes the document by.
 *
 * ## Why the numbers are read as numbers
 *
 * `starts_at`, `ends_at` and `current_sequence` are `bigint`, and the PostgreSQL driver returns
 * `bigint` as a **string** so a 64-bit value is not silently truncated to a float. Comparing them
 * as strings is lexicographic — `"9" >= "10"` is true — and declares a live range exhausted at its
 * ninth document.
 */
@Injectable()
export class FiscalRangeService {
  private readonly logger = new Logger(FiscalRangeService.name);

  constructor(
    private readonly vault: CertificateVaultService,
    /** The documents that already carry numbers drawn from the ranges, without importing them. */
    private readonly issuedNumbers: IssuedFiscalNumbersRegistry,
  ) {}

  /**
   * Advance the range and return the number it granted.
   *
   * @param today the issuing date, `YYYY-MM-DD`, in the TENANT's fiscal timezone. Passed in rather
   *   than read from the clock here: a range that expired yesterday must refuse a document dated
   *   today in Santiago even when the server's own day has not turned over yet.
   */
  async drawNext(
    manager: EntityManager,
    criteria: FiscalRangeCriteria & { today: string; withSecret?: boolean },
  ): Promise<DrawnFiscalNumber> {
    const { organizationId, countryCode, documentType, today } = criteria;
    const range = await this.lockActive(manager, criteria);

    if (!range) {
      throw new BadRequestError('einvoicing.no_active_authorized_range_document_type', {
        country: countryCode.toUpperCase(),
        type: documentType,
      });
    }

    const { current, end } = this.cursorOf(range);
    if (current >= end) {
      throw new BadRequestError('einvoicing.authorized_range_type_type_exhausted_range', {
        type: documentType,
        from: String(range.startsAt),
        to: String(range.endsAt),
      });
    }

    if (range.validUntil && range.validUntil < today) {
      throw new BadRequestError('einvoicing.authorization_type_type_range_expired_date', {
        type: documentType,
        date: range.validUntil,
      });
    }

    const next = current + 1;
    range.currentSequence = next;
    await manager.save(range);

    // Loud on purpose, and only near the end: a range that runs out mid-morning stops the tenant
    // invoicing until an authority grants another, which in several of these markets takes days.
    if (end - next <= LOW_WATERMARK_ABSOLUTE) {
      this.logger.warn(
        `Rango fiscal ${countryCode}/${documentType} de la organización ${organizationId}: ` +
          `quedan ${end - next} números.`,
      );
    }

    return {
      number: next,
      series: range.series,
      documentType: range.documentType,
      validUntil: range.validUntil ?? null,
      authorizationCode: range.authorizationCode ?? null,
      secret: criteria.withSecret ? this.secretOf(range) : null,
      secretKind: range.secretKind ?? null,
    };
  }

  /**
   * The active range of a type, locked for the rest of the caller's transaction, or null.
   *
   * For an operation that must not race an issuance: drawing a number, closing a stretch the
   * authority was told will never be used. Several active ranges of one type exist only across
   * series; without a series to narrow by, the earliest is the one drawn from.
   */
  async lockActive(manager: EntityManager, criteria: FiscalRangeCriteria): Promise<FiscalDocumentRange | null> {
    const query = manager
      .getRepository(FiscalDocumentRange)
      .createQueryBuilder('range')
      .where(
        'range.organizationId = :organizationId AND range.countryCode = :countryCode ' +
          'AND range.documentType = :documentType AND range.isActive = true',
        {
          organizationId: criteria.organizationId,
          countryCode: criteria.countryCode.toUpperCase(),
          documentType: criteria.documentType,
        },
      );
    const selector = typeof criteria.series === 'string' ? { kind: 'EXACT' as const, series: criteria.series } : criteria.series;
    if (selector?.kind === 'EXACT') {
      query.andWhere('range.series = :series', { series: selector.series });
    } else if (selector?.kind === 'PREFIX') {
      query.andWhere('left(range.series, :length) = :prefix', { length: selector.prefix.length, prefix: selector.prefix });
    }
    return query.orderBy('range.startsAt', 'ASC').addOrderBy('range.series', 'ASC').setLock('pessimistic_write').getOne();
  }

  /**
   * Close the numbers from the range's next one through `to`, so they are never issued: what an
   * authority's annulment of unused numbers requires locally. Only for a stretch that starts at the
   * next unissued number — a hole in the middle of a range cannot be expressed by a single cursor,
   * and pretending otherwise would silently skip numbers. Call with the range locked
   * (`lockActive`), in the transaction that declares the stretch.
   */
  assertClosableStretch(range: FiscalDocumentRange, from: number, to: number): void {
    const { current, end } = this.cursorOf(range);
    const next = current + 1;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) {
      throw new BadRequestError('einvoicing.range_from_not_valid_final_number', { from: String(from), to: String(to) });
    }
    if (from < next) throw new BadRequestError('einvoicing.range_stretch_already_issued', { next });
    if (from > next) throw new BadRequestError('einvoicing.range_stretch_must_start_at_next', { next });
    if (to > end) throw new BadRequestError('einvoicing.range_stretch_beyond_end', { endsAt: end });
  }

  /** Advance the locked range's cursor through `to`; a range with nothing left is retired. */
  async closeThrough(manager: EntityManager, range: FiscalDocumentRange, to: number): Promise<FiscalDocumentRange> {
    const { end } = this.cursorOf(range);
    range.currentSequence = to;
    if (to >= end) range.isActive = false;
    return manager.save(range);
  }

  /**
   * Of these document types, the ones the company can draw a number for today: an active range of
   * the market with numbers left whose authorisation has not expired. What the invoicing screen
   * offers, so it never offers a type `drawNext` would then refuse.
   */
  async liveDocumentTypes(
    manager: EntityManager,
    criteria: { organizationId: string; countryCode: string; documentTypes: readonly string[]; today: string },
  ): Promise<Set<string>> {
    if (!criteria.documentTypes.length) return new Set();
    const rows: Array<{ type: string }> = await manager
      .getRepository(FiscalDocumentRange)
      .createQueryBuilder('range')
      .select('DISTINCT range.documentType', 'type')
      .where('range.organizationId = :organizationId', { organizationId: criteria.organizationId })
      .andWhere('range.countryCode = :countryCode', { countryCode: criteria.countryCode.toUpperCase() })
      .andWhere('range.isActive = true')
      .andWhere('range.documentType IN (:...types)', { types: [...criteria.documentTypes] })
      .andWhere('range.currentSequence < range.endsAt')
      .andWhere('(range.validUntil IS NULL OR range.validUntil >= :today)', { today: criteria.today })
      .getRawMany();
    return new Set(rows.map((row) => row.type));
  }

  /**
   * The range a number already issued came from, without drawing anything.
   *
   * Needed because building the document happens after the number was assigned, and two regimes
   * need something the range holds: Chile seals the document's timbre with the CAF's own RSA key,
   * and Colombia computes the CUFE with the resolution's technical key. Looking those up by "the
   * active range" would be wrong the moment a range is superseded — a document numbered 9 from CAF
   * A, built after CAF B was registered, must still be sealed with A's key or the SII rejects it.
   *
   * So the lookup is by containment: the range of the document's series whose bounds enclose the
   * consecutive it was drawn as — both recorded on the document when the number was drawn.
   */
  async rangeContaining(
    manager: EntityManager,
    criteria: {
      organizationId: string;
      countryCode: string;
      documentType: string;
      number: number;
      series?: string;
    },
  ): Promise<FiscalDocumentRange> {
    const query = manager
      .getRepository(FiscalDocumentRange)
      .createQueryBuilder('range')
      .where(
        'range.organizationId = :organizationId AND range.countryCode = :countryCode ' +
          'AND range.documentType = :documentType ' +
          'AND range.startsAt <= :number AND range.endsAt >= :number',
        {
          organizationId: criteria.organizationId,
          countryCode: criteria.countryCode.toUpperCase(),
          documentType: criteria.documentType,
          number: criteria.number,
        },
      );

    if (criteria.series !== undefined) {
      query.andWhere('range.series = :series', { series: criteria.series });
    }

    // Newest first: overlapping ranges of one series cannot be registered, and if two ever exist
    // the later authorisation is the one a document issued today was drawn from.
    const range = await query.orderBy('range.startsAt', 'DESC').getOne();
    if (!range) {
      throw new BadRequestError('einvoicing.no_authorized_range_type_type_contains', {
        type: criteria.documentType,
        number: String(criteria.number),
      });
    }
    return range;
  }

  /** The decrypted secret of a range, for a caller that already holds the row. */
  secretOfRange(range: FiscalDocumentRange): string {
    return this.secretOf(range);
  }

  /**
   * Register a range the authority granted, superseding the active one of the same type and series.
   *
   * Refused, for every market alike, when:
   *
   * - the market does not number from ranges (a stamp, the authority's own counter, no fiscal
   *   number at all): the range would never be drawn from, and the screen would say it is in force;
   * - the type is not one the market's authority publishes;
   * - the series is not one the authority allows for the type (`MarketNumbering.acceptsSeries`);
   * - the type's ranges expire and none was given, or the authorisation has already lapsed;
   * - it overlaps ANY range registered before for the type and series, active or not — a retired
   *   range's numbers were still issued;
   * - any of its numbers is already on a document (`IssuedFiscalNumbersRegistry`).
   *
   * Concurrent registrations of the same type and series are serialised by an advisory lock, so two
   * submissions of the same form cannot both pass the overlap check. The unique index on the issued
   * fiscal number stays the last line of defence.
   *
   * The secret is encrypted here rather than by the caller, so there is one place where the
   * decision "this never touches a column in the clear" is made and one place to audit it.
   */
  async register(manager: EntityManager, input: FiscalRangeRegistration): Promise<FiscalDocumentRange> {
    const { startsAt, endsAt, organizationId } = input;
    if (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) || startsAt < 1 || endsAt < startsAt) {
      throw new BadRequestError('einvoicing.range_from_not_valid_final_number', { from: String(startsAt), to: String(endsAt) });
    }

    const countryCode = input.countryCode.toUpperCase();
    const market = knownMarket(countryCode);
    const authority = fiscalAuthorityOf(countryCode);
    if (!market || market.documents.numbering.source !== 'AUTHORITY_RANGE') {
      throw new BadRequestError('einvoicing.market_does_not_number_from_ranges', { authority });
    }

    const documentType = input.documentType.trim().toUpperCase();
    const type = market.documents.types.find((candidate) => candidate.code.toUpperCase() === documentType);
    if (!type) {
      throw new BadRequestError('einvoicing.range_type_not_in_market_catalogue', { type: documentType, authority });
    }

    const series = (input.series ?? '').trim().toUpperCase();
    const acceptsSeries = market.documents.numbering.acceptsSeries;
    if (acceptsSeries && !acceptsSeries(type.code, series)) {
      throw new BadRequestError('einvoicing.series_series_does_not_match_document', { series: series || '—', type: type.code, authority });
    }

    const validUntil = input.validUntil ? input.validUntil.slice(0, 10) : null;
    if (type.expirationRequired && !validUntil) {
      throw new BadRequestError('einvoicing.range_expiry_date_required', { type: type.code });
    }
    if (validUntil && validUntil < input.today) {
      throw new BadRequestError('einvoicing.range_authorization_already_expired', { date: validUntil });
    }
    if (input.secret && !input.secretKind) {
      throw new BadRequestError('einvoicing.you_supplied_secret_material_range_but');
    }

    // Two submissions of the same range must not both pass the checks below: the second waits for
    // the first's transaction, then sees its row.
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `fiscal-range:${organizationId}:${countryCode}:${type.code}:${series}`,
    ]);

    const repo = manager.getRepository(FiscalDocumentRange);
    const overlapping = await repo
      .createQueryBuilder('range')
      .where('range.organizationId = :organizationId', { organizationId })
      .andWhere('range.countryCode = :countryCode', { countryCode })
      .andWhere('range.documentType = :documentType', { documentType: type.code })
      .andWhere('range.series = :series', { series })
      .andWhere('range.startsAt <= :endsAt', { endsAt })
      .andWhere('range.endsAt >= :startsAt', { startsAt })
      .orderBy('range.startsAt', 'ASC')
      .getMany();
    if (overlapping.length > 0) {
      throw new ConflictError('einvoicing.range_overlaps_registered', {
        type: type.code,
        startsAt,
        endsAt,
        ranges: overlapping.map((range) => `${range.startsAt}–${range.endsAt}`).join(', '),
      });
    }

    const alreadyIssued = await this.issuedNumbers.countWithin(manager, {
      organizationId,
      documentType: type.code,
      series,
      from: startsAt,
      to: endsAt,
    });
    if (alreadyIssued > 0) {
      throw new ConflictError('einvoicing.range_numbers_already_issued', { count: alreadyIssued, type: type.code, startsAt, endsAt });
    }

    // Superseding rather than deleting: the old range is what past documents were drawn from, and
    // an inspector asking which authorisation covered a document from March needs the row to exist.
    await repo.update({ organizationId, countryCode, documentType: type.code, series, isActive: true }, { isActive: false });

    const range = repo.create({
      organizationId,
      countryCode,
      documentType: type.code,
      series,
      startsAt,
      endsAt,
      // The first draw returns `startsAt`.
      currentSequence: startsAt - 1,
      isActive: true,
      validUntil,
      authorizationCode: input.authorizationCode?.trim() || null,
      secretKind: input.secretKind ?? null,
      encryptedSecret: input.secret ? this.vault.encrypt(input.secret) : null,
    });
    const saved = await repo.save(range);
    this.logger.log(`Rango ${countryCode}/${type.code}${series ? ` ${series}` : ''} ${startsAt}–${endsAt} registrado para la organización ${organizationId}.`);
    return saved;
  }

  /**
   * Put a range back in force, or retire it, without deleting it.
   *
   * Reactivating is how a range superseded by mistake comes back; it retires the one in force for
   * the same type and series, since only one may be drawn from. A range with nothing left or whose
   * authorisation lapsed is not reactivated: it would retire the live one and leave the type with
   * nothing to issue from.
   */
  async setActive(
    manager: EntityManager,
    criteria: { organizationId: string; countryCode: string; rangeId: string; isActive: boolean; today: string },
  ): Promise<FiscalDocumentRange> {
    const repo = manager.getRepository(FiscalDocumentRange);
    const countryCode = criteria.countryCode.toUpperCase();
    const range = await repo.findOne({ where: { id: criteria.rangeId, organizationId: criteria.organizationId, countryCode } });
    if (!range) throw new NotFoundError('einvoicing.range_not_found');
    if (range.isActive === criteria.isActive) return range;

    if (criteria.isActive) {
      const { current, end } = this.cursorOf(range);
      if (current >= end) throw new BadRequestError('einvoicing.range_exhausted_cannot_reactivate', { type: range.documentType });
      if (range.validUntil && range.validUntil < criteria.today) {
        throw new BadRequestError('einvoicing.range_expired_cannot_reactivate', { type: range.documentType, date: range.validUntil });
      }
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `fiscal-range:${criteria.organizationId}:${countryCode}:${range.documentType}:${range.series}`,
      ]);
      await repo.update(
        { organizationId: criteria.organizationId, countryCode, documentType: range.documentType, series: range.series, isActive: true },
        { isActive: false },
      );
    }
    range.isActive = criteria.isActive;
    return repo.save(range);
  }

  /** How close a range is to running out or lapsing, for the alert the tenant needs before it does. */
  healthOf(range: FiscalDocumentRange, today: string): { remaining: number; runningLow: boolean; expired: boolean } {
    const startsAt = Number(range.startsAt);
    const { current, end } = this.cursorOf(range);
    const size = Math.max(1, end - startsAt + 1);
    const remaining = Math.max(0, end - current);
    return {
      remaining,
      runningLow: range.isActive && (remaining <= LOW_WATERMARK_ABSOLUTE || remaining / size <= LOW_WATERMARK_FRACTION),
      expired: Boolean(range.validUntil && range.validUntil < today),
    };
  }

  /** The cursor and the last number of a range, as numbers, or a refusal for a corrupt row. */
  private cursorOf(range: FiscalDocumentRange): { current: number; end: number } {
    const current = Number(range.currentSequence);
    const end = Number(range.endsAt);
    if (!Number.isFinite(current) || !Number.isFinite(end)) {
      throw new InternalServerError('einvoicing.authorized_range_type_type_has_non', { type: range.documentType });
    }
    return { current, end };
  }

  /**
   * The range's secret, decrypted, or a refusal naming what is missing.
   *
   * Read only when a caller needs it — the Chilean TED needs the CAF's private key, the Colombian
   * CUFE needs the technical key — so it is not materialised on every draw.
   */
  private secretOf(range: FiscalDocumentRange): string {
    if (!range.encryptedSecret) {
      throw new BadRequestError('einvoicing.range_type_type_has_no_record', {
        type: range.documentType,
      });
    }
    return this.vault.decrypt(range.encryptedSecret).toString('utf8');
  }
}
