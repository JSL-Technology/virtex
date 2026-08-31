
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { AccountSegmentDefinition } from './entities/account-segment-definition.entity';
import { ConfigureAccountSegmentsDto } from './dto/account-segment-definition.dto';
import { Account } from './entities/account.entity';
import { coaSegmentsFor } from '../localization/fiscal/coa-builder';

@Injectable()
export class AccountSegmentsService {
  private readonly logger = new Logger(AccountSegmentsService.name);

  constructor(
    @InjectRepository(AccountSegmentDefinition)
    private readonly segmentDefinitionRepository: Repository<AccountSegmentDefinition>,
    private readonly dataSource: DataSource,
  ) {}

  findByOrg(organizationId: string): Promise<AccountSegmentDefinition[]> {
    return this.segmentDefinitionRepository.find({
      where: { organizationId },
      order: { order: 'ASC' },
    });
  }

  async configure(
    dto: ConfigureAccountSegmentsDto,
    organizationId: string,
  ): Promise<AccountSegmentDefinition[]> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AccountSegmentDefinition);
      const accountRepo = manager.getRepository(Account);

      // 1. Validar si ya existen cuentas creadas.
      // Si existen cuentas, no se permite cambiar la estructura de segmentos
      // porque invalidaría los códigos de cuenta existentes.
      const accountCount = await accountRepo.count({
        where: { organizationId },
      });

      if (accountCount > 0) {
        throw new BadRequestException(
          'No se puede modificar la estructura de segmentos porque ya existen cuentas contables creadas para esta organización.',
        );
      }

      // 2. Limpiar definiciones anteriores
      await repo.delete({ organizationId });

      // 3. Crear nuevas definiciones
      const definitions = dto.segments.map((segmentDto, index) => {
        return repo.create({
          ...segmentDto,
          organizationId,
          order: index,
        });
      });

      return repo.save(definitions);
    });
  }

  /**
   * Give an organization the account-code structure its chart of accounts is written in.
   *
   * `structure` comes from `coaSegmentsFor(countryCode)`, which is declared beside the country's
   * chart-of-accounts template. That is the whole point: this used to write a fixed four-level
   * structure (1-2-2-3) into every organization while the templates emitted a single four-digit
   * code, so `ChartOfAccountsService.create` rejected the first account of every new tenant and
   * provisioning died on the opening balance sheet. One declaration now feeds both sides.
   *
   * Idempotent, and deliberately so: it runs on organization creation and is also exposed as an
   * endpoint for tenants that predate it.
   */
  async initializeDefault(
    organizationId: string,
    manager?: EntityManager,
    structure?: readonly { name: string; length: number; isRequired: boolean }[],
  ): Promise<AccountSegmentDefinition[]> {
    const repo = manager
      ? manager.getRepository(AccountSegmentDefinition)
      : this.segmentDefinitionRepository;

    const existing = await repo.find({
      where: { organizationId },
    });

    if (existing.length > 0) {
      this.logger.log(
        `La organización ${organizationId} ya tiene segmentos configurados. Omitiendo inicialización.`,
      );
      return existing;
    }

    // Falls back to the country-agnostic template shape rather than to the old 1-2-2-3 guess,
    // so a caller that omits the structure still produces codes the templates can satisfy.
    const specs = structure ?? coaSegmentsFor('');
    const defaults = specs.map((spec, order) => ({
      name: spec.name,
      length: spec.length,
      isRequired: spec.isRequired,
      order,
    }));

    const definitions = defaults.map((d) =>
      repo.create({
        ...d,
        organizationId,
      }),
    );

    this.logger.log(
      `Inicializando estructura de segmentos por defecto para organización ${organizationId}`,
    );
    return repo.save(definitions);
  }
}