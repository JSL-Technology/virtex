import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  FiscalDocumentRange,
  FiscalRangeSecretKind,
} from '../entities/fiscal-document-range.entity';
import { CertificateVaultService } from './certificate-vault.service';
import { BadRequestError, InternalServerError } from '../../i18n/localized.exception';

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

/**
 * Draws the next number from a tenant's authorised range, once.
 *
 * ## The lock is the whole point
 *
 * `SELECT … FOR UPDATE` inside the caller's transaction, exactly as `ComplianceService.getNextNcf`
 * does for the Dominican Republic. Without it, two issuances that read the counter before either
 * writes it both get the same number: the authority accepts the first document and rejects the
 * second, and the taxpayer is left explaining a duplicate to an inspector. A fiscal number is not
 * a display value — it is the identity the authority indexes the document by.
 *
 * ## Why the numbers are read as numbers
 *
 * `starts_at`, `ends_at` and `current_sequence` are `bigint`, and the PostgreSQL driver returns
 * `bigint` as a **string** so a 64-bit value is not silently truncated to a float. Comparing them
 * as strings is lexicographic — `"9" >= "10"` is true — and declares a live range exhausted at its
 * ninth document. The Dominican service hit this and documents it; this one is written knowing it.
 */
@Injectable()
export class FiscalRangeService {
  private readonly logger = new Logger(FiscalRangeService.name);

  constructor(private readonly vault: CertificateVaultService) {}

  /**
   * Advance the range and return the number it granted.
   *
   * @param today the issuing date, `YYYY-MM-DD`, in the TENANT's fiscal timezone. Passed in rather
   *   than read from the clock here: a range that expired yesterday must refuse a document dated
   *   today in Santiago even when the server's own day has not turned over yet.
   */
  async drawNext(
    manager: EntityManager,
    criteria: {
      organizationId: string;
      countryCode: string;
      documentType: string;
      series?: string;
      today: string;
      withSecret?: boolean;
    },
  ): Promise<DrawnFiscalNumber> {
    const { organizationId, countryCode, documentType, today } = criteria;

    const query = manager
      .getRepository(FiscalDocumentRange)
      .createQueryBuilder('range')
      .where(
        'range.organizationId = :organizationId AND range.countryCode = :countryCode ' +
          'AND range.documentType = :documentType AND range.isActive = true',
        { organizationId, countryCode: countryCode.toUpperCase(), documentType },
      );

    // A series narrows the search where the market has one; where it does not, the tenant holds a
    // single active range for the type and asking for a particular series would find nothing.
    if (criteria.series !== undefined) {
      query.andWhere('range.series = :series', { series: criteria.series });
    }

    const range = await query
      .orderBy('range.startsAt', 'ASC')
      .setLock('pessimistic_write')
      .getOne();

    if (!range) {
      throw new BadRequestError('EINVOICING.RANGO_FISCAL_NO_CONFIGURADO', {
        country: countryCode.toUpperCase(),
        type: documentType,
      });
    }

    const current = Number(range.currentSequence);
    const end = Number(range.endsAt);
    if (!Number.isFinite(current) || !Number.isFinite(end)) {
      throw new InternalServerError('EINVOICING.RANGO_FISCAL_LIMITES_NO_NUMERICOS', {
        type: documentType,
      });
    }

    if (current >= end) {
      throw new BadRequestError('EINVOICING.RANGO_FISCAL_AGOTADO', {
        type: documentType,
        from: String(range.startsAt),
        to: String(range.endsAt),
      });
    }

    if (range.validUntil && range.validUntil < today) {
      throw new BadRequestError('EINVOICING.RANGO_FISCAL_VENCIDO', {
        type: documentType,
        date: range.validUntil,
      });
    }

    const next = current + 1;
    range.currentSequence = next;
    await manager.save(range);

    // Loud on purpose, and only near the end: a range that runs out mid-morning stops the tenant
    // invoicing until an authority grants another, which in several of these markets takes days.
    if (end - next <= 50) {
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
   * Series conventions an authority enforces, checked when the range is registered.
   *
   * Only Peru has one that can be got wrong silently. SUNAT identifies a comprobante by
   * `RUC-TipoDocumento-Serie-Correlativo`, and the series letter must agree with the type: an `F`
   * series is a factura (`01`), a `B` series a boleta (`03`), an `FC`/`BC` series their credit
   * notes (`07`). A range registered with the wrong pairing produces documents SUNAT refuses
   * **before reading them**, with a message about the series rather than about anything the tenant
   * did on the invoice — and it does so for every document drawn from that range, not just one.
   *
   * Checked here rather than at issuance because a range is registered once and drawn from
   * thousands of times, and because at issuance the only remedy left is refusing to invoice.
   *
   * *Verificar con contabilidad/legal*: SUNAT revises catálogo 01 by resolution, and a taxpayer
   * with a special authorisation may hold series this does not anticipate.
   */
  private assertSeriesMatchesType(countryCode: string, documentType: string, series: string): void {
    if (countryCode !== 'PE' || !series) return;

    const letter = series[0]?.toUpperCase();
    const expected: Record<string, string[]> = {
      '01': ['F'],
      '03': ['B'],
      // A credit note follows the series of the document it credits, so both letters are valid.
      '07': ['F', 'B'],
      '08': ['F', 'B'],
    };

    const allowed = expected[documentType];
    if (allowed && !allowed.includes(letter)) {
      throw new BadRequestError('EINVOICING.SUNAT_SERIE_NO_CORRESPONDE_AL_TIPO', {
        series,
        type: documentType,
      });
    }
  }

  /**
   * The range's secret, decrypted, or a refusal naming what is missing.
   *
   * Read only when a caller needs it — the Chilean TED needs the CAF's private key, the Colombian
   * CUFE needs the technical key — so it is not materialised on every draw.
   */
  private secretOf(range: FiscalDocumentRange): string {
    if (!range.encryptedSecret) {
      throw new BadRequestError('EINVOICING.RANGO_FISCAL_SIN_SECRETO', {
        type: range.documentType,
      });
    }
    return this.vault.decrypt(range.encryptedSecret).toString('utf8');
  }

  /**
   * Register a range the authority granted.
   *
   * The secret is encrypted here rather than by the caller, so there is one place where the
   * decision "this never touches a column in the clear" is made and one place to audit it.
   */
  async register(
    manager: EntityManager,
    input: {
      organizationId: string;
      countryCode: string;
      documentType: string;
      series?: string;
      startsAt: number;
      endsAt: number;
      validUntil?: string | null;
      authorizationCode?: string | null;
      secret?: string | null;
      secretKind?: FiscalRangeSecretKind | null;
    },
  ): Promise<FiscalDocumentRange> {
    if (input.endsAt < input.startsAt) {
      throw new BadRequestError('EINVOICING.RANGO_FISCAL_LIMITES_INVALIDOS', {
        from: String(input.startsAt),
        to: String(input.endsAt),
      });
    }

    const repo = manager.getRepository(FiscalDocumentRange);
    const countryCode = input.countryCode.toUpperCase();
    const series = input.series ?? '';

    this.assertSeriesMatchesType(countryCode, input.documentType, series);

    // Superseding rather than deleting: the old range is what past documents were drawn from, and
    // an inspector asking which authorisation covered a document from March needs the row to exist.
    await repo.update(
      {
        organizationId: input.organizationId,
        countryCode,
        documentType: input.documentType,
        series,
        isActive: true,
      },
      { isActive: false },
    );

    const range = repo.create({
      organizationId: input.organizationId,
      countryCode,
      documentType: input.documentType,
      series,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      // The first draw returns `startsAt`.
      currentSequence: input.startsAt - 1,
      isActive: true,
      validUntil: input.validUntil ?? null,
      authorizationCode: input.authorizationCode ?? null,
      secretKind: input.secretKind ?? null,
      encryptedSecret: input.secret ? this.vault.encrypt(input.secret) : null,
    });

    return repo.save(range);
  }
}
