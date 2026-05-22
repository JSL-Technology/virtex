import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { DocumentSequence, DocumentType } from './entities/document-sequence.entity';

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
      throw new InternalServerErrorException(`No se encontró una secuencia de documento activa para el tipo ${type}. Por favor, configure las secuencias.`);
    }

    const nextNumber = sequence.nextNumber;
    sequence.nextNumber++;
    await manager.save(sequence);


    const formattedNumber = nextNumber.toString().padStart(8, '0');
    return `${sequence.prefix}${formattedNumber}`;
  }
}