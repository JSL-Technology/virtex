import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdentityDocumentType } from '../entities/identity-document-type.entity';
import {
  DocumentAppliesTo,
  DocumentContext,
  IDENTITY_DOCUMENT_TYPES,
  IdentityDocumentTypeSpec,
  SUPRANATIONAL_COUNTRY,
  canonicalize,
} from '../fiscal/identity-document-catalogue';
import { resolveChecksum } from '../fiscal/document-checksums';

/**
 * The one place that answers "what identifies a person or a company in this country, and is this
 * value a valid one?".
 *
 * ## Why every module has to come through here
 *
 * Before this existed the same question had four answers. Registration validated arithmetically
 * against `TAX_ID_RULES` and refused a country it had no algorithm for. Invoicing delegated to the
 * regime adapter. HCM ran the Dominican JCE rule over every country's employees. Customers and
 * suppliers ran nothing at all — `@IsString()` and a free-text column. A Chilean tenant could
 * therefore register a correctly checked RUT, save a customer with a RUT nobody looked at, and be
 * unable to save an employee with their RUN, in one sitting.
 *
 * One service, one catalogue, one verdict.
 *
 * ## Read-through cache, not a snapshot
 *
 * The catalogue is global reference data that changes when somebody inserts a row, which is the
 * whole point of moving it out of an enum. Caching it forever would restore the deploy-to-add-a-
 * country behaviour through the back door, so the cache carries a TTL and `refresh()` drops it.
 * The TTL is generous because the data is nearly static; it exists so an INSERT takes effect
 * without a restart, not to track a fast-moving table.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** What `validate` says, and why. Richer than a boolean because the caller has to explain itself. */
export interface DocumentValidationResult {
  valid: boolean;
  /**
   * Why it failed, as a catalogue key the caller turns into a message.
   *
   * `unknown_type` is deliberately distinct from `invalid_format`: the first means the country
   * does not issue this document and is a programming or data error, the second means the user
   * mistyped. Collapsing them is how "your cédula is invalid" got shown to a Chilean.
   */
  reason?: 'unknown_type' | 'invalid_format' | 'invalid_checksum' | 'unresolvable_checksum';
  /** The value as it should be stored, set only when `valid`. */
  canonical?: string;
}


/** What a party (employee, customer, supplier) ended up with, or why it could not be resolved. */
export type ResolvedPartyDocument =
  | { ok: true; value: string | null; typeCode: string | null; countryCode: string | null }
  | { ok: false; reason: 'type_required' | 'type_not_issued' | 'invalid' | 'value_required'; code?: string; country: string; documentLabel?: string; detail?: DocumentValidationResult['reason'] };

/** The inputs every party form supplies, whatever the module. */
export interface PartyDocumentInput {
  /** The document as typed. Empty or absent clears the whole triple. */
  value?: string | null;
  /** The catalogue code the caller chose, if any. */
  typeCode?: string | null;
  /** The issuing country, when it is not the fallback. A foreign customer's own country. */
  documentCountry?: string | null;
  /** Where to look when the caller named no country — normally the tenant's. */
  fallbackCountry: string;
  appliesTo: DocumentAppliesTo;
  usedFor: DocumentContext;
  /**
   * Reject an empty value when the country declares a `required` document for this context.
   *
   * Off by default, because `requirement` is not one rule for every caller: an employee must be
   * identifiable to the social-security authority, so payroll turns this on, while a walk-in
   * consumer legitimately has no tax id, so the customer form leaves it off and the buyer-tax-id
   * requirement is enforced per fiscal document type at invoice time instead. This is what makes
   * the stored `requirement` finally mean something rather than travel to the client unread.
   */
  enforceRequirement?: boolean;
}

@Injectable()
export class IdentityDocumentService implements OnModuleInit {
  private readonly logger = new Logger(IdentityDocumentService.name);
  private cache: IdentityDocumentType[] | null = null;
  private cachedAt = 0;

  constructor(
    @InjectRepository(IdentityDocumentType)
    private readonly repository: Repository<IdentityDocumentType>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /**
   * Bring the table in line with the declared catalogue.
   *
   * Upsert by `(country_code, code)`, never delete. A row an operator added by hand for a document
   * this file does not declare is exactly the extension mechanism the refactor promises; wiping it
   * on the next boot would make that promise false. Removing a document is `valid_until`, not a
   * DELETE — see the entity.
   */
  private async seed(): Promise<void> {
    for (const spec of IDENTITY_DOCUMENT_TYPES) {
      // A spec naming a checksum that does not resolve would validate as pattern-only at runtime,
      // which is a silent downgrade. Refuse to seed it; the catalogue spec test catches it earlier.
      if (spec.checksum && !resolveChecksum(spec.checksum)) {
        throw new Error(
          `Identity document ${spec.countryCode}.${spec.code} names checksum "${spec.checksum}", ` +
            `which is not registered in CHECKSUM_ALGORITHMS.`,
        );
      }

      // tenant-scope-guard-allow: identity document types are global reference data.
      const existing = await this.repository.findOne({
        where: { countryCode: spec.countryCode, code: spec.code },
      });
      const row = this.rowFor(spec);
      if (existing) {
        await this.repository.save({ ...existing, ...row });
      } else {
        this.logger.log(`Sembrando tipo de documento ${spec.countryCode}.${spec.code}`);
        await this.repository.save(this.repository.create(row));
      }
    }
    this.invalidate();
  }

  private rowFor(spec: IdentityDocumentTypeSpec): Partial<IdentityDocumentType> {
    return {
      countryCode: spec.countryCode,
      code: spec.code,
      labelKey: spec.labelKey,
      labelVerbatim: spec.labelVerbatim ?? null,
      example: spec.example ?? null,
      pattern: spec.pattern,
      checksum: spec.checksum,
      canonicalForm: spec.canonicalForm,
      appliesTo: spec.appliesTo,
      requirement: spec.requirement,
      usedFor: [...spec.usedFor],
      isDefault: spec.isDefault ?? false,
      issuingAuthority: spec.issuingAuthority ?? null,
      sortOrder: spec.sortOrder,
    };
  }

  /** Drop the cache. Called after seeding and available to an admin that edits the catalogue. */
  invalidate(): void {
    this.cache = null;
    this.cachedAt = 0;
  }

  private async all(): Promise<IdentityDocumentType[]> {
    if (this.cache && Date.now() - this.cachedAt < CACHE_TTL_MS) return this.cache;
    // tenant-scope-guard-allow: identity document types are global reference data.
    const rows = await this.repository.find({ order: { sortOrder: 'ASC', code: 'ASC' } });
    this.cache = rows;
    this.cachedAt = Date.now();
    return rows;
  }

  /**
   * What a country can offer, optionally narrowed.
   *
   * Always includes the supranational entries, so a passport is offered in every market without
   * being duplicated nineteen times and without being attributed to the employer's country.
   * Entries whose validity window has closed are excluded from NEW forms while remaining
   * resolvable by `find`, so a stored historical value still renders.
   */
  async listForCountry(
    countryCode: string,
    filters: { appliesTo?: DocumentAppliesTo; usedFor?: DocumentContext } = {},
  ): Promise<IdentityDocumentType[]> {
    const country = (countryCode ?? '').trim().toUpperCase();
    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.all();

    return rows.filter((row) => {
      if (row.countryCode !== country && row.countryCode !== SUPRANATIONAL_COUNTRY) return false;
      if (row.validFrom && row.validFrom > today) return false;
      if (row.validUntil && row.validUntil < today) return false;
      // 'both' satisfies either request; a request for 'both' is a request for everything.
      if (filters.appliesTo && filters.appliesTo !== 'both') {
        if (row.appliesTo !== 'both' && row.appliesTo !== filters.appliesTo) return false;
      }
      if (filters.usedFor && !row.usedFor?.includes(filters.usedFor)) return false;
      return true;
    });
  }

  /**
   * One entry, by the key the business tables store.
   *
   * Falls back to the supranational country so a caller holding `('CL', 'PASSPORT')` — which is
   * how a stored row reads when the passport was chosen for a Chilean employee — still resolves.
   */
  async find(countryCode: string, code: string): Promise<IdentityDocumentType | null> {
    const country = (countryCode ?? '').trim().toUpperCase();
    const wanted = (code ?? '').trim().toUpperCase();
    if (!country || !wanted) return null;
    const rows = await this.all();
    return (
      rows.find((row) => row.countryCode === country && row.code === wanted) ??
      rows.find((row) => row.countryCode === SUPRANATIONAL_COUNTRY && row.code === wanted) ??
      null
    );
  }


  /**
   * Resolve and validate a party's identity document — the one routine every module shares.
   *
   * ## Why it lives here and not in each module
   *
   * The audit's central finding was not that HCM validated badly; it was that four modules each
   * answered "is this a valid identifier?" for themselves. Registration checked arithmetically and
   * refused an unknown country. Invoicing delegated to the regime adapter. HCM applied the
   * Dominican algorithms to everyone. Sales and purchasing checked nothing at all. Fixing HCM in
   * isolation would have produced five answers instead of four.
   *
   * So the rule lives in one method and the callers differ only in which catalogue key they phrase
   * the rejection with — which is a presentation difference, and the only one there should be.
   *
   * ## What it returns rather than throws
   *
   * A result, not an exception, because the message a customer form should show is not the message
   * an employee form should show: one says "that is not a valid NIT", the other "that is not a
   * valid cédula de ciudadanía", and both are this method's caller's business. What is NOT the
   * caller's business is whether the value passes, and that verdict is made here only.
   */
  async resolveParty(input: PartyDocumentInput): Promise<ResolvedPartyDocument> {
    const raw = input.value?.trim() ?? '';
    const country = input.documentCountry?.trim().toUpperCase() || input.fallbackCountry;

    if (!raw) {
      // A caller that enforces the requirement asks the catalogue whether this country mandates a
      // document here before accepting the blank. `requirement` was stored, published to the client
      // and never read; this is the read. A country that declares no required document for the
      // context — or the caller opting out — still clears cleanly.
      if (input.enforceRequirement) {
        const required = await this.defaultFor(country, input.appliesTo, input.usedFor);
        if (required && required.requirement === 'required') {
          return {
            ok: false,
            reason: 'value_required',
            country,
            documentLabel: required.labelVerbatim ?? required.code,
          };
        }
      }
      // No document clears the type with it: a type with no value asserts that the party holds a
      // Colombian cédula whose number nobody recorded.
      return { ok: true, value: null, typeCode: null, countryCode: null };
    }

    // Where the caller named no type, the catalogue's own default for this country decides — the
    // cédula in Santo Domingo, the CURP in Mexico City, the CC in Bogotá. Never a constant.
    const code =
      input.typeCode?.trim().toUpperCase() ||
      (await this.defaultFor(country, input.appliesTo, input.usedFor))?.code;

    if (!code) return { ok: false, reason: 'type_required', country };

    const entry = await this.find(country, code);
    if (!entry) return { ok: false, reason: 'type_not_issued', code, country };

    const verdict = await this.validate(country, code, raw);
    if (!verdict.valid) {
      return {
        ok: false,
        reason: 'invalid',
        code,
        country,
        // The document's own name, so the rejection says "that is not a valid CURP" rather than
        // naming a document the reader has never held.
        documentLabel: entry.labelVerbatim ?? entry.code,
        detail: verdict.reason,
      };
    }

    return {
      ok: true,
      value: verdict.canonical ?? raw,
      typeCode: entry.code,
      // The entry's OWN country, so a passport stores as `XX` rather than as the tenant's.
      countryCode: entry.countryCode,
    };
  }

  /** The pre-selected option for a context, or null when the country names none. */
  async defaultFor(
    countryCode: string,
    appliesTo: DocumentAppliesTo,
    usedFor: DocumentContext,
  ): Promise<IdentityDocumentType | null> {
    const candidates = await this.listForCountry(countryCode, { appliesTo, usedFor });
    return candidates.find((row) => row.isDefault) ?? candidates[0] ?? null;
  }

  /**
   * Validate a value against the rule that belongs to its own document type.
   *
   * The pattern runs first because it is cheap and because a value of the wrong shape should be
   * reported as such rather than as a failed check digit — "that is not eleven digits" is a more
   * useful sentence than "the check digit is wrong".
   */
  async validate(
    countryCode: string,
    code: string,
    value: string,
  ): Promise<DocumentValidationResult> {
    const entry = await this.find(countryCode, code);
    if (!entry) return { valid: false, reason: 'unknown_type' };

    const trimmed = (value ?? '').trim();
    if (!new RegExp(entry.pattern).test(trimmed)) {
      return { valid: false, reason: 'invalid_format' };
    }

    if (entry.checksum) {
      const algorithm = resolveChecksum(entry.checksum);
      if (!algorithm) {
        // A row citing an unknown algorithm is a data defect. Failing closed is the only safe
        // answer: falling through to "the pattern passed" would silently weaken the check.
        this.logger.error(
          `El tipo de documento ${entry.countryCode}.${entry.code} referencia el algoritmo ` +
            `"${entry.checksum}", que no existe en CHECKSUM_ALGORITHMS.`,
        );
        return { valid: false, reason: 'unresolvable_checksum' };
      }
      if (!algorithm(trimmed)) return { valid: false, reason: 'invalid_checksum' };
    }

    return { valid: true, canonical: canonicalize(entry.canonicalForm, trimmed) };
  }
}

/**
 * The stored form of a document value now lives in `identity-document-catalogue.ts`, so the
 * synchronous `canonicalizeTaxId` there can share it without importing this injectable. Re-exported
 * here because callers and tests have long imported it from the service.
 */
export { canonicalize };
