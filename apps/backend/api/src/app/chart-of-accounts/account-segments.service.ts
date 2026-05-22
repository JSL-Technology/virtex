
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { AccountSegmentDefinition } from './entities/account-segment-definition.entity';
import { ConfigureAccountSegmentsDto } from './dto/account-segment-definition.dto';
import { Account } from './entities/account.entity';

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
   * Inicializa la estructura de segmentos por defecto para una organización
   * si no tiene una definida. Es idempotente.
   */
  async initializeDefault(
    organizationId: string,
    manager?: EntityManager,
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

    const defaults = [
      { name: 'Nivel 1', length: 1, isRequired: true, order: 0 },
      { name: 'Nivel 2', length: 2, isRequired: true, order: 1 },
      { name: 'Nivel 3', length: 2, isRequired: true, order: 2 },
      { name: 'Nivel 4', length: 3, isRequired: true, order: 3 },
    ];

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