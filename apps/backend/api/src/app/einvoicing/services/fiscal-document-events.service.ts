import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FiscalDocumentEvent, FiscalDocumentEventKind } from '../entities/fiscal-document-event.entity';

/**
 * What this tenant has declared ABOUT documents, whichever regime it files under.
 *
 * Reading the record is the same act in every market — the table is neutral and so is this — while
 * BUILDING and transmitting a declaration is its regime's (`FiscalDocumentEventsPort`). The door
 * used to read them through the Dominican service, so listing a tenant's declarations meant going
 * through one country's code.
 */
@Injectable()
export class FiscalDocumentEventsService {
  constructor(
    @InjectRepository(FiscalDocumentEvent)
    private readonly events: Repository<FiscalDocumentEvent>,
  ) {}

  /** Everything this tenant has declared, newest first, optionally of one kind. */
  list(organizationId: string, kind?: FiscalDocumentEventKind): Promise<FiscalDocumentEvent[]> {
    return this.events.find({
      where: { organizationId, ...(kind ? { kind } : {}) },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }
}
