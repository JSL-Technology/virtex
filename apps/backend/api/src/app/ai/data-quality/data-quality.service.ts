import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { hasPermission } from '@virteex/shared/util-auth';
import {
  DuplicateEntityType,
  DuplicateRecord,
  DuplicateSourceRegistry,
} from '../../contracts/data-quality/duplicate-sources.contract';
import { ForbiddenError, NotFoundError } from '../../i18n/localized.exception';
import { AiDuplicateSuggestion, DuplicateStatus } from '../entities/ai-duplicate-suggestion.entity';
import { findDuplicates } from './duplicate-matching';

/** Records read per type in one scan; a book larger than this is scanned in its first part. */
const MAX_RECORDS = 50_000;
const PAGE = 2_000;

export interface DataQualityUser {
  id: string;
  permissions: string[];
}

/**
 * Master-data quality: probable duplicate customers, suppliers and products.
 *
 * A scan reads each type's records through `DuplicateSourceRegistry` (each module offers its
 * own), finds the probable pairs with `findDuplicates`, and keeps the table in step: new pairs are
 * proposed, a pair no longer found (renamed, deactivated) goes STALE, and a pair a person already
 * decided on keeps that decision. Nothing is merged — merging moves ledgers and documents, and is
 * a decision with accounting consequences, not a suggestion.
 *
 * Everyone sees only the types they may read, and decides only on the types they may edit.
 */
@Injectable()
export class DataQualityService {
  private readonly logger = new Logger(DataQualityService.name);

  constructor(
    private readonly sources: DuplicateSourceRegistry,
    @InjectRepository(AiDuplicateSuggestion) private readonly suggestions: Repository<AiDuplicateSuggestion>,
  ) {}

  async scan(organizationId: string): Promise<Record<string, { found: number; added: number; stale: number }>> {
    const summary: Record<string, { found: number; added: number; stale: number }> = {};
    for (const source of this.sources.all()) {
      const records: DuplicateRecord[] = [];
      for (let offset = 0; offset < MAX_RECORDS; offset += PAGE) {
        const page = await source.records(organizationId, offset, PAGE);
        records.push(...page);
        if (page.length < PAGE) break;
      }
      const pairs = findDuplicates(records);
      const existing = await this.suggestions.find({ where: { organizationId, entityType: source.type } });
      const byKey = new Map(existing.map((row) => [`${row.recordAId}|${row.recordBId}`, row]));
      const found = new Set<string>();
      const toSave: AiDuplicateSuggestion[] = [];
      let added = 0;
      for (const pair of pairs) {
        const key = `${pair.a.id}|${pair.b.id}`;
        found.add(key);
        const row = byKey.get(key);
        if (row) {
          row.score = pair.score;
          row.reasons = pair.reasons;
          row.labelA = pair.a.name.slice(0, 300);
          row.labelB = pair.b.name.slice(0, 300);
          // A pair that came back after going stale is open again; a decision stands.
          if (row.status === 'STALE') row.status = 'OPEN';
          toSave.push(row);
        } else {
          added++;
          toSave.push(
            this.suggestions.create({
              organizationId,
              entityType: source.type,
              recordAId: pair.a.id,
              recordBId: pair.b.id,
              labelA: pair.a.name.slice(0, 300),
              labelB: pair.b.name.slice(0, 300),
              score: pair.score,
              reasons: pair.reasons,
              status: 'OPEN',
            }),
          );
        }
      }
      let stale = 0;
      for (const row of existing) {
        if (row.status === 'OPEN' && !found.has(`${row.recordAId}|${row.recordBId}`)) {
          row.status = 'STALE';
          toSave.push(row);
          stale++;
        }
      }
      for (let start = 0; start < toSave.length; start += 500) await this.suggestions.save(toSave.slice(start, start + 500));
      summary[source.type] = { found: pairs.length, added, stale };
    }
    this.logger.log(`Duplicate scan for ${organizationId}: ${JSON.stringify(summary)}`);
    return summary;
  }

  /** The types this person may read. */
  visibleTypes(user: DataQualityUser): DuplicateEntityType[] {
    return this.sources
      .all()
      .filter((source) => hasPermission(user.permissions, [source.viewPermission]))
      .map((source) => source.type);
  }

  async list(organizationId: string, user: DataQualityUser, query: { type?: DuplicateEntityType; status?: DuplicateStatus; limit?: number; offset?: number }) {
    const visible = this.visibleTypes(user);
    const types = query.type ? visible.filter((type) => type === query.type) : visible;
    if (!types.length) return { total: 0, items: [], counts: {} };
    const [rows, total] = await this.suggestions.findAndCount({
      where: { organizationId, entityType: In(types), status: query.status ?? 'OPEN' },
      order: { score: 'DESC', detectedAt: 'DESC' },
      take: Math.min(Math.max(query.limit ?? 50, 1), 200),
      skip: Math.max(query.offset ?? 0, 0),
    });
    const counts: Record<string, number> = {};
    for (const type of visible) {
      counts[type] = await this.suggestions.count({ where: { organizationId, entityType: type, status: 'OPEN' } });
    }
    return {
      total,
      counts,
      items: rows.map((row) => ({
        ...row,
        linkA: this.sources.get(row.entityType)?.link(row.recordAId) ?? null,
        linkB: this.sources.get(row.entityType)?.link(row.recordBId) ?? null,
      })),
    };
  }

  async decide(organizationId: string, user: DataQualityUser, id: string, decision: 'SAME' | 'NOT_DUPLICATE' | 'OPEN') {
    const row = await this.suggestions.findOne({ where: { id, organizationId } });
    if (!row) throw new NotFoundError('ai.data_quality.not_found');
    const source = this.sources.get(row.entityType);
    if (!source || !hasPermission(user.permissions, [source.editPermission])) {
      throw new ForbiddenError('ai.data_quality.cannot_decide');
    }
    row.status = decision;
    row.decidedByUserId = decision === 'OPEN' ? null : user.id;
    row.decidedAt = decision === 'OPEN' ? null : new Date();
    return this.suggestions.save(row);
  }
}
