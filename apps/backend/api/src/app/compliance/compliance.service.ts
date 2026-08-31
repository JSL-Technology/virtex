
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { EntityManager, Repository } from 'typeorm';
import { NcfSequence, NcfType } from './entities/ncf-sequence.entity';
import { VendorBill } from '../accounts-payable/entities/vendor-bill.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { DominicanRepublicReports } from './reports/dr-reports';

@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(NcfSequence)
    private readonly ncfSequenceRepository: Repository<NcfSequence>,
    @InjectRepository(VendorBill)
    private readonly vendorBillRepository: Repository<VendorBill>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
  ) {}

  async getNextNcf(
    organizationId: string,
    type: NcfType,
    manager: EntityManager,
  ): Promise<string> {
    const sequence = await manager
      .getRepository(NcfSequence)
      .createQueryBuilder('seq')
      .where(
        'seq.organizationId = :organizationId AND seq.type = :type AND seq.isActive = true',
        { organizationId, type },
      )
      .setLock('pessimistic_write')
      .getOne();

    if (!sequence) {
      throw new InternalServerErrorException(`No se encontró una secuencia de NCF activa para el tipo ${type}`);
    }

    // `starts_at`, `ends_at` and `current_sequence` are `bigint` columns, which the driver returns
    // as strings. Comparing and incrementing them as strings was silently wrong: `"9" >= "10"` is
    // true lexicographically, so a live range could be declared exhausted long before it was, and
    // `"9"++` relied on implicit coercion. e-NCF sequences fit comfortably in a JS safe integer
    // (max 10 digits), so we coerce to Number and operate numerically.
    const current = Number(sequence.currentSequence);
    const end = Number(sequence.endsAt);
    if (!Number.isFinite(current) || !Number.isFinite(end)) {
      throw new InternalServerErrorException(`La secuencia de NCF para el tipo ${type} tiene límites no numéricos.`);
    }

    if (current >= end) {
      throw new InternalServerErrorException(`La secuencia de NCF para el tipo ${type} se ha agotado.`);
    }

    if (sequence.expiresAt) {
      const today = new Date().toISOString().split('T')[0];
      if (sequence.expiresAt < today) {
        throw new InternalServerErrorException(
          `La autorización de la secuencia de NCF para el tipo ${type} venció el ${sequence.expiresAt}.`,
        );
      }
    }

    const next = current + 1;
    sequence.currentSequence = next;
    await manager.save(sequence);

    // Legacy NCF (B-series) use an 8-digit sequence (`B01` + 8 = 11 chars); electronic NCF
    // (e-CF, E-series) use a 10-digit sequence (`E31` + 10 = 13 chars). The width follows the prefix.
    const width = sequence.prefix.toUpperCase().startsWith('E') ? 10 : 8;
    const sequenceNumber = next.toString().padStart(width, '0');
    return `${sequence.prefix}${sequenceNumber}`;
  }
  
  /**
   * Registers a DGII-authorized NCF/e-NCF range for a tenant. Without this, a freshly onboarded
   * organization has no active sequence and every invoice fails — the range comes from the DGII
   * authorization, so it must be entered per tenant, never seeded blindly. Provisioning a new active
   * range of a given type deactivates the previous active one so `getNextNcf` is unambiguous.
   */
  async provisionNcfSequence(
    organizationId: string,
    input: { type: NcfType; prefix: string; startsAt: number; endsAt: number },
  ): Promise<NcfSequence> {
    const { type, prefix, startsAt, endsAt } = input;
    if (!Number.isInteger(startsAt) || !Number.isInteger(endsAt) || startsAt < 1 || endsAt < startsAt) {
      throw new InternalServerErrorException('El rango de la secuencia NCF es inválido (startsAt/endsAt).');
    }

    return this.ncfSequenceRepository.manager.transaction(async (manager) => {
      await manager
        .getRepository(NcfSequence)
        .update({ organizationId, type, isActive: true }, { isActive: false });

      const sequence = manager.create(NcfSequence, {
        organizationId,
        type,
        prefix,
        startsAt,
        endsAt,
        // First getNextNcf returns `startsAt`.
        currentSequence: startsAt - 1,
        isActive: true,
      });
      return manager.save(sequence);
    });
  }

  async listNcfSequences(organizationId: string): Promise<NcfSequence[]> {
    return this.ncfSequenceRepository.find({ where: { organizationId } });
  }

  async generate607Report(organizationId: string, year: number, month: number): Promise<string> {
     // TODO: Check organization country before generating.
     return DominicanRepublicReports.generate607Report(organizationId, year, month, this.invoiceRepository);
  }

  async generate606Report(organizationId: string, year: number, month: number): Promise<string> {
     // TODO: Check organization country before generating.
     return DominicanRepublicReports.generate606Report(organizationId, year, month, this.vendorBillRepository);
  }
}