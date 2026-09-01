import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { NcfSequence, NcfType } from './entities/ncf-sequence.entity';
import { VendorBill } from '../accounts-payable/entities/vendor-bill.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { DominicanRepublicReports } from './reports/dr-reports';

/** A fiscal number, together with the authorization window it was drawn from. */
export interface AssignedFiscalNumber {
  ncf: string;
  type: NcfType;
  /** `YYYY-MM-DD` expiry of the DGII authorization, or null for a range that carries none. */
  expiresAt: string | null;
}

/** How close a range is to running out, for the alerting the tenant needs before it does. */
export interface NcfSequenceStatus {
  id: string;
  type: NcfType;
  prefix: string;
  startsAt: number;
  endsAt: number;
  currentSequence: number;
  remaining: number;
  isActive: boolean;
  expiresAt: string | null;
  authorizationCode: string | null;
  /** True when fewer than 10 % of the range, or fewer than 50 numbers, remain. */
  runningLow: boolean;
  expired: boolean;
}

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  /** Below this many remaining numbers a range is flagged, whatever its size. */
  private static readonly LOW_WATERMARK_ABSOLUTE = 50;
  private static readonly LOW_WATERMARK_FRACTION = 0.1;

  constructor(
    @InjectRepository(NcfSequence)
    private readonly ncfSequenceRepository: Repository<NcfSequence>,
    @InjectRepository(VendorBill)
    private readonly vendorBillRepository: Repository<VendorBill>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
  ) {}

  /**
   * Draw the next fiscal number of a type, under a row lock, and report the authorization window
   * it belongs to.
   *
   * The lock matters: two concurrent sales of the same type must not receive the same number, and
   * `SELECT … FOR UPDATE` on the sequence row is what serialises them. The returned expiry is
   * stamped on the document because `FechaVencimientoSecuencia` is a mandatory element of the e-CF
   * and must reflect the authorization in force when the number was issued, not whatever the range
   * says later.
   */
  async getNextNcf(
    organizationId: string,
    type: NcfType,
    manager: EntityManager,
  ): Promise<AssignedFiscalNumber> {
    const sequence = await manager
      .getRepository(NcfSequence)
      .createQueryBuilder('seq')
      .where(
        'seq.organizationId = :organizationId AND seq.type = :type AND seq.isActive = true',
        { organizationId, type },
      )
      .orderBy('seq.startsAt', 'ASC')
      .setLock('pessimistic_write')
      .getOne();

    if (!sequence) {
      throw new BadRequestException(
        `No hay una secuencia de NCF activa para el tipo ${type}. Registra el rango autorizado por la ` +
          `DGII en Ajustes → Facturación Electrónica antes de emitir este comprobante.`,
      );
    }

    // `starts_at`, `ends_at` and `current_sequence` are `bigint`, which the driver returns as
    // strings. Comparing them as strings was silently wrong — `"9" >= "10"` is true
    // lexicographically — so a live range could be declared exhausted long before it was.
    const current = Number(sequence.currentSequence);
    const end = Number(sequence.endsAt);
    if (!Number.isFinite(current) || !Number.isFinite(end)) {
      throw new InternalServerErrorException(
        `La secuencia de NCF para el tipo ${type} tiene límites no numéricos.`,
      );
    }

    if (current >= end) {
      throw new BadRequestException(
        `La secuencia de NCF para el tipo ${type} se agotó (rango ${sequence.startsAt}–${sequence.endsAt}). ` +
          `Solicita un nuevo rango a la DGII y regístralo antes de continuar facturando.`,
      );
    }

    if (sequence.expiresAt) {
      const today = new Date().toISOString().split('T')[0];
      if (sequence.expiresAt < today) {
        throw new BadRequestException(
          `La autorización de la secuencia de NCF para el tipo ${type} venció el ${sequence.expiresAt}. ` +
            `Registra el nuevo rango autorizado antes de emitir.`,
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

    return {
      ncf: `${sequence.prefix}${sequenceNumber}`,
      type,
      expiresAt: sequence.expiresAt ?? null,
    };
  }

  /**
   * Register a DGII-authorized NCF/e-NCF range.
   *
   * ## The defect this closes
   *
   * Provisioning used to deactivate the previous range of the same type and start the new counter at
   * `startsAt - 1`, with no check that the new range overlapped numbers already issued. Re-entering
   * the same range — a user re-submitting the form, or re-registering after a failed attempt —
   * therefore reset the counter and handed out fiscal numbers that were already printed on
   * customers' invoices. Reproduced, it returned `E310000000001` immediately after having issued
   * `E310000000002`. Duplicating a comprobante fiscal is a tax offence, so this now:
   *
   *   - rejects a range that overlaps ANY previously registered range of the same type, active or
   *     not, because a deactivated range's numbers were still issued;
   *   - rejects a range whose numbers already appear on an issued document;
   *   - keeps the unique index `UQ_invoices_org_ncf` as the last line of defence.
   */
  async provisionNcfSequence(
    organizationId: string,
    input: {
      type: NcfType;
      prefix: string;
      startsAt: number;
      endsAt: number;
      expiresAt?: string | null;
      authorizationCode?: string | null;
    },
  ): Promise<NcfSequence> {
    const { type, prefix, startsAt, endsAt } = input;

    if (!Number.isInteger(startsAt) || !Number.isInteger(endsAt) || startsAt < 1 || endsAt < startsAt) {
      throw new BadRequestException(
        'El rango de la secuencia NCF es inválido: el número final debe ser mayor o igual que el inicial.',
      );
    }
    if (prefix.toUpperCase() !== type) {
      throw new BadRequestException(
        `El prefijo "${prefix}" no corresponde al tipo de comprobante ${type}.`,
      );
    }
    if (input.expiresAt) {
      const today = new Date().toISOString().split('T')[0];
      if (input.expiresAt < today) {
        throw new BadRequestException(
          'La fecha de vencimiento de la autorización ya pasó; el rango no podría usarse.',
        );
      }
    }

    return this.ncfSequenceRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(NcfSequence);

      // Overlap against every range ever registered for this type, active or not.
      const overlapping = await repo
        .createQueryBuilder('seq')
        .where('seq.organizationId = :organizationId', { organizationId })
        .andWhere('seq.type = :type', { type })
        .andWhere('seq.startsAt <= :endsAt', { endsAt })
        .andWhere('seq.endsAt >= :startsAt', { startsAt })
        .setLock('pessimistic_write')
        .getMany();

      if (overlapping.length > 0) {
        const ranges = overlapping.map((s) => `${s.startsAt}–${s.endsAt}`).join(', ');
        throw new ConflictException(
          `El rango ${startsAt}–${endsAt} de ${type} se solapa con un rango ya registrado (${ranges}). ` +
            `Reutilizar una numeración ya emitida generaría comprobantes fiscales duplicados.`,
        );
      }

      // Belt and braces: a number inside the new range that is already on a document means the
      // range was issued under some earlier state this table no longer reflects.
      const width = prefix.toUpperCase().startsWith('E') ? 10 : 8;
      const first = `${prefix}${String(startsAt).padStart(width, '0')}`;
      const last = `${prefix}${String(endsAt).padStart(width, '0')}`;
      const alreadyIssued = await manager
        .getRepository(Invoice)
        .createQueryBuilder('invoice')
        .where('invoice.organizationId = :organizationId', { organizationId })
        .andWhere('invoice.ncfNumber BETWEEN :first AND :last', { first, last })
        .getCount();
      if (alreadyIssued > 0) {
        throw new ConflictException(
          `Ya existen ${alreadyIssued} comprobante(s) emitidos con números dentro del rango ${first}–${last}.`,
        );
      }

      // Only one range of a type may be active; the unique index enforces it, this makes the
      // transition explicit and ordered.
      await repo.update({ organizationId, type, isActive: true }, { isActive: false });

      const sequence = repo.create({
        organizationId,
        type,
        prefix: prefix.toUpperCase(),
        startsAt,
        endsAt,
        // The first getNextNcf returns `startsAt`.
        currentSequence: startsAt - 1,
        isActive: true,
        expiresAt: input.expiresAt ?? null,
        authorizationCode: input.authorizationCode ?? null,
      });
      const saved = await repo.save(sequence);
      this.logger.log(
        `Rango ${type} ${startsAt}–${endsAt} registrado para la organización ${organizationId}.`,
      );
      return saved;
    });
  }

  /** Re-activate a range that was superseded, e.g. after registering the wrong one. */
  async setSequenceActive(
    organizationId: string,
    sequenceId: string,
    isActive: boolean,
  ): Promise<NcfSequence> {
    return this.ncfSequenceRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(NcfSequence);
      const sequence = await repo.findOne({ where: { id: sequenceId, organizationId } });
      if (!sequence) throw new NotFoundException('Secuencia NCF no encontrada.');

      if (isActive) {
        await repo.update({ organizationId, type: sequence.type, isActive: true }, { isActive: false });
      }
      sequence.isActive = isActive;
      return repo.save(sequence);
    });
  }

  async listNcfSequences(organizationId: string): Promise<NcfSequenceStatus[]> {
    const rows = await this.ncfSequenceRepository.find({
      where: { organizationId },
      order: { type: 'ASC', startsAt: 'ASC' },
    });
    const today = new Date().toISOString().split('T')[0];

    return rows.map((row) => {
      const startsAt = Number(row.startsAt);
      const endsAt = Number(row.endsAt);
      const currentSequence = Number(row.currentSequence);
      const size = Math.max(1, endsAt - startsAt + 1);
      const remaining = Math.max(0, endsAt - currentSequence);
      return {
        id: row.id,
        type: row.type,
        prefix: row.prefix,
        startsAt,
        endsAt,
        currentSequence,
        remaining,
        isActive: row.isActive,
        expiresAt: row.expiresAt ?? null,
        authorizationCode: row.authorizationCode ?? null,
        runningLow:
          row.isActive &&
          (remaining <= ComplianceService.LOW_WATERMARK_ABSOLUTE ||
            remaining / size <= ComplianceService.LOW_WATERMARK_FRACTION),
        expired: Boolean(row.expiresAt && row.expiresAt < today),
      };
    });
  }

  /** The active range for a type, or null. Used to pre-flight an issuance without consuming one. */
  async findActiveSequence(organizationId: string, type: NcfType): Promise<NcfSequence | null> {
    return this.ncfSequenceRepository.findOne({
      where: { organizationId, type, isActive: true },
    });
  }

  // ── DGII periodic reports ──────────────────────────────────────────────────

  async generate607Report(organizationId: string, year: number, month: number): Promise<string> {
    await this.assertDominicanRepublic(organizationId, '607');
    return DominicanRepublicReports.generate607Report(
      organizationId,
      year,
      month,
      this.invoiceRepository,
      await this.requireOrganization(organizationId),
    );
  }

  async generate606Report(organizationId: string, year: number, month: number): Promise<string> {
    await this.assertDominicanRepublic(organizationId, '606');
    return DominicanRepublicReports.generate606Report(
      organizationId,
      year,
      month,
      this.vendorBillRepository,
      await this.requireOrganization(organizationId),
    );
  }

  async generate608Report(organizationId: string, year: number, month: number): Promise<string> {
    await this.assertDominicanRepublic(organizationId, '608');
    return DominicanRepublicReports.generate608Report(
      organizationId,
      year,
      month,
      this.invoiceRepository,
      await this.requireOrganization(organizationId),
    );
  }

  async generate609Report(organizationId: string, year: number, month: number): Promise<string> {
    await this.assertDominicanRepublic(organizationId, '609');
    return DominicanRepublicReports.generate609Report(
      organizationId,
      year,
      month,
      this.vendorBillRepository,
      await this.requireOrganization(organizationId),
    );
  }

  private async requireOrganization(organizationId: string): Promise<Organization> {
    const organization = await this.organizationRepository.findOne({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('Organización no encontrada.');
    return organization;
  }

  /**
   * The 606/607/608/609 are formats of the Dominican tax authority. Generating one for a Mexican or
   * Chilean tenant produced a plausible-looking file that means nothing to their own authority —
   * the previous code carried a `TODO: Check organization country` and shipped it anyway.
   */
  private async assertDominicanRepublic(organizationId: string, report: string): Promise<void> {
    const organization = await this.requireOrganization(organizationId);
    const country = (organization.country ?? '').toUpperCase();
    if (country !== 'DO') {
      throw new BadRequestException(
        `El formato ${report} es un envío de la DGII (República Dominicana) y no aplica a una ` +
          `organización registrada en ${organization.country ?? 'otro país'}.`,
      );
    }
  }
}
