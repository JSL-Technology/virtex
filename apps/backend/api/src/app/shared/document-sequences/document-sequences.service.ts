import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { DocumentSequence, DocumentType } from './entities/document-sequence.entity';
import { BadRequestError, InternalServerError, NotFoundError } from '../../i18n/localized.exception';

@Injectable()
export class DocumentSequencesService {
  constructor(
    @InjectRepository(DocumentSequence)
    private readonly sequenceRepository: Repository<DocumentSequence>,
  ) {}

  async getNextNumber(
    organizationId: string,
    type: DocumentType,
    manager: EntityManager,
  ): Promise<string> {
    const sequence = await manager
      .getRepository(DocumentSequence)
      .createQueryBuilder('seq')
      .where(
        'seq.organizationId = :organizationId AND seq.type = :type',
        { organizationId, type },
      )
      .setLock('pessimistic_write')
      .getOne();

    if (!sequence) {
      throw new InternalServerError('shared.no_active_document_sequence_found_type', { type });
    }

    const nextNumber = sequence.nextNumber;
    sequence.nextNumber++;
    await manager.save(sequence);


    return format(sequence.prefix, Number(nextNumber));
  }

  /** The tenant's sequences, each with the number it will issue next, formatted (QA M-09). */
  async list(organizationId: string): Promise<Array<DocumentSequence & { nextFormatted: string }>> {
    const rows = await this.sequenceRepository.find({ where: { organizationId }, order: { type: 'ASC' } });
    return rows.map((row) => ({ ...row, nextNumber: Number(row.nextNumber), nextFormatted: format(row.prefix, Number(row.nextNumber)) }));
  }

  /**
   * Change a sequence's prefix, or move its next number forward.
   *
   * Never backward: a number below the next one may already be on a document, and issuing it again
   * would give two invoices the same number. Moving forward is legitimate (continuing a numbering
   * started in another system) and leaves a declared gap rather than a duplicate.
   */
  async update(
    organizationId: string,
    type: DocumentType,
    change: { prefix?: string; nextNumber?: number },
  ): Promise<DocumentSequence & { nextFormatted: string }> {
    return this.sequenceRepository.manager.transaction(async (manager) => {
      const sequence = await manager
        .getRepository(DocumentSequence)
        .createQueryBuilder('seq')
        .where('seq.organizationId = :organizationId AND seq.type = :type', { organizationId, type })
        .setLock('pessimistic_write')
        .getOne();
      if (!sequence) throw new NotFoundError('shared.document_sequence_not_found', { type });

      if (change.prefix !== undefined) {
        const prefix = change.prefix.trim();
        if (!/^[A-Za-z0-9_/-]{0,20}$/.test(prefix)) throw new BadRequestError('shared.document_sequence_prefix_format');
        sequence.prefix = prefix;
      }
      if (change.nextNumber !== undefined) {
        const next = Number(change.nextNumber);
        if (!Number.isInteger(next) || next < 1) throw new BadRequestError('shared.document_sequence_next_number_positive');
        if (next < Number(sequence.nextNumber)) {
          throw new BadRequestError('shared.document_sequence_cannot_go_back', { current: Number(sequence.nextNumber) });
        }
        sequence.nextNumber = next;
      }
      const saved = await manager.save(sequence);
      return { ...saved, nextNumber: Number(saved.nextNumber), nextFormatted: format(saved.prefix, Number(saved.nextNumber)) };
    });
  }
}

function format(prefix: string, number: number): string {
  return `${prefix}${number.toString().padStart(8, '0')}`;
}
