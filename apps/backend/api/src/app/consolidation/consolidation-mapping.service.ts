import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsolidationMap } from './entities/consolidation-map.entity';
import { CreateConsolidationMapDto } from './dto/create-consolidation-map.dto';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { OrganizationSubsidiary } from '../organizations/entities/organization-subsidiary.entity';
import { NotFoundError } from '../i18n/localized.exception';

/**
 * El mapeo de cuentas entre una matriz y una de sus subsidiarias.
 *
 * ## El agujero que cerró este fichero
 *
 * `subsidiaryOrganizationId` llega en el CUERPO de la petición, y la única comprobación que
 * recibía era que la organización existiera:
 *
 *     const subOrg = await this.orgRepository.findOneBy({ id: subsidiaryOrganizationId });
 *     if (!parentOrg || !subOrg) throw new NotFoundError('consolidation.organization_not_found');
 *
 * «Existe» no es «es tuya». Cualquier administrador de cualquier inquilino —`financials:consolidate`,
 * que el `'*'` del rol ADMINISTRADOR satisface— podía nombrar el id de otra empresa del producto y
 * escribir filas que la mencionan, y después leerlas con las relaciones `subsidiaryAccount` y
 * `parentAccount` hidratadas, exponiendo nombre, código y tipo de cuentas ajenas.
 *
 * Es el caso de manual: cambiar un identificador en el cuerpo de una petición. Y era el ÚNICO
 * punto del módulo donde la pertenencia al grupo la declaraba el cliente — `runConsolidation` ya
 * la deriva de `organization_subsidiaries`, que es la tabla que dice de verdad quién es
 * subsidiaria de quién. Este servicio ahora pregunta a la misma tabla.
 *
 * ## Y las cuentas también se comprueban
 *
 * Verificar el vínculo padre-subsidiaria es necesario y no suficiente: `mappings[]` nombra dos
 * cuentas por fila, y sin comprobarlas un miembro legítimo del grupo podría apuntar
 * `parentAccountId` a una cuenta de una tercera empresa. Cada cuenta se valida contra la
 * organización a la que debe pertenecer: la del padre para `parentAccountId`, la de la subsidiaria
 * para `subsidiaryAccountId`.
 */
@Injectable()
export class ConsolidationMappingService {
  private readonly logger = new Logger(ConsolidationMappingService.name);

  constructor(
    @InjectRepository(ConsolidationMap)
    private readonly mapRepository: Repository<ConsolidationMap>,
    @InjectRepository(OrganizationSubsidiary)
    private readonly subsidiaryRepository: Repository<OrganizationSubsidiary>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {}

  /**
   * ¿Es `subsidiaryOrganizationId` una subsidiaria de `parentOrganizationId`?
   *
   * Responde lo mismo a «no existe» que a «no es tuya» —`NotFoundError`— a propósito: distinguirlas
   * permitiría enumerar qué empresas hay en el producto probando identificadores, que es el mismo
   * oráculo que `ActiveTenantGuard` cierra para la cabecera de empresa activa.
   */
  private async assertIsSubsidiaryOf(
    parentOrganizationId: string,
    subsidiaryOrganizationId: string,
  ): Promise<void> {
    const linked = await this.subsidiaryRepository.exist({
      where: { parentOrganizationId, subsidiaryOrganizationId },
    });

    if (!linked) {
      this.logger.warn(
        {
          event: 'consolidation_mapping_denied',
          parentOrganizationId,
          requested: subsidiaryOrganizationId,
        },
        '[SECURITY] Se pidió el mapeo de consolidación de una empresa que no es subsidiaria de quien pregunta',
      );
      throw new NotFoundError('consolidation.organization_not_found');
    }
  }

  /**
   * Toda cuenta nombrada tiene que pertenecer a la empresa que le corresponde.
   *
   * Se consulta en UNA query por lado en lugar de una por cuenta: el mapeo de un grupo real trae
   * cientos de filas, y un `findOne` por cuenta convertiría una petición en cientos de viajes.
   */
  private async assertAccountsBelongTo(
    organizationId: string,
    accountIds: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(accountIds)];
    if (unique.length === 0) return;

    const found = await this.accountRepository.find({
      where: unique.map((id) => ({ id, organizationId })),
      select: ['id'],
    });

    if (found.length !== unique.length) {
      const seen = new Set(found.map((account) => account.id));
      const missing = unique.filter((id) => !seen.has(id));
      this.logger.warn(
        { event: 'consolidation_mapping_account_denied', organizationId, missing },
        '[SECURITY] El mapeo nombra cuentas que no son de la empresa que debería poseerlas',
      );
      throw new NotFoundError('consolidation.account_not_found');
    }
  }

  async getMapForSubsidiary(parentOrganizationId: string, subsidiaryOrganizationId: string) {
    await this.assertIsSubsidiaryOf(parentOrganizationId, subsidiaryOrganizationId);

    return this.mapRepository.find({
      where: { parentOrganizationId, subsidiaryOrganizationId },
      relations: ['subsidiaryAccount', 'parentAccount'],
    });
  }

  async createOrUpdateMap(parentOrganizationId: string, dto: CreateConsolidationMapDto) {
    const { subsidiaryOrganizationId, mappings } = dto;

    await this.assertIsSubsidiaryOf(parentOrganizationId, subsidiaryOrganizationId);

    await Promise.all([
      this.assertAccountsBelongTo(
        parentOrganizationId,
        mappings.map((m) => m.parentAccountId),
      ),
      this.assertAccountsBelongTo(
        subsidiaryOrganizationId,
        mappings.map((m) => m.subsidiaryAccountId),
      ),
    ]);

    // Borrado y reescritura en UNA transacción. Sin ella, un fallo a mitad deja al grupo sin
    // mapeo —la consolidación pasa a reportar `UNMAPPED_ACCOUNT` para todo— y nadie se entera
    // hasta el cierre.
    return this.mapRepository.manager.transaction(async (manager) => {
      await manager.delete(ConsolidationMap, { parentOrganizationId, subsidiaryOrganizationId });

      const newMappings = mappings.map((m) =>
        manager.create(ConsolidationMap, {
          parentOrganizationId,
          subsidiaryOrganizationId,
          subsidiaryAccountId: m.subsidiaryAccountId,
          parentAccountId: m.parentAccountId,
        }),
      );

      await manager.save(newMappings);

      return {
        messageKey: 'consolidation.mapping_updated_with_count_correspondences',
        params: { count: newMappings.length },
      };
    });
  }
}
