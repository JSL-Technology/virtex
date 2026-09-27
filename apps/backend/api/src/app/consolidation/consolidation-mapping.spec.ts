import { NotFoundException } from '@nestjs/common';

import { ConsolidationMappingService } from './consolidation-mapping.service';

/**
 * El mapeo de consolidación tomaba del CUERPO de la petición qué empresa es «la subsidiaria», y
 * solo comprobaba que existiera:
 *
 *     const subOrg = await this.orgRepository.findOneBy({ id: subsidiaryOrganizationId });
 *     if (!parentOrg || !subOrg) throw new NotFoundError(...);
 *
 * «Existe» no es «es tuya». Cualquier administrador —`financials:consolidate`, que el `'*'` del
 * rol ADMINISTRADOR satisface— podía nombrar el id de otra empresa del producto y escribir filas
 * que la mencionan, para después leerlas con `subsidiaryAccount` hidratada y ver cuentas ajenas.
 *
 * Era además el ÚNICO punto del módulo donde la pertenencia al grupo la declaraba el cliente:
 * `runConsolidation` ya la deriva de `organization_subsidiaries`. Estas pruebas fijan que este
 * servicio pregunte a la misma tabla.
 */
describe('ConsolidationMappingService — la relación de grupo no la declara el cliente', () => {
  const PARENT = 'parent-org';
  const SUBSIDIARY = 'subsidiary-org';
  const VICTIM = 'someone-elses-org';

  function build(options: { linked?: boolean; accountOrgs?: Record<string, string> } = {}) {
    const linked = options.linked ?? true;
    const accountOrgs = options.accountOrgs ?? {};

    const savedRows: unknown[] = [];
    const manager = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((_entity: unknown, row: unknown) => row),
      save: jest.fn(async (rows: unknown[]) => {
        savedRows.push(...rows);
        return rows;
      }),
    };

    const mapRepository = {
      find: jest.fn().mockResolvedValue([]),
      manager: { transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)) },
    };

    const subsidiaryRepository = {
      exist: jest.fn(async ({ where }: { where: { subsidiaryOrganizationId: string } }) =>
        linked && where.subsidiaryOrganizationId === SUBSIDIARY),
    };

    const accountRepository = {
      find: jest.fn(async ({ where }: { where: Array<{ id: string; organizationId: string }> }) =>
        where.filter((criterion) => accountOrgs[criterion.id] === criterion.organizationId)),
    };

    const service = new ConsolidationMappingService(
      mapRepository as never,
      subsidiaryRepository as never,
      accountRepository as never,
    );

    return { service, mapRepository, subsidiaryRepository, accountRepository, savedRows };
  }

  it('refuses to write a mapping naming an organization that is not a subsidiary of the caller', async () => {
    const { service, savedRows } = build({ linked: true });

    await expect(
      service.createOrUpdateMap(PARENT, {
        subsidiaryOrganizationId: VICTIM,
        mappings: [{ subsidiaryAccountId: 'a', parentAccountId: 'b' }],
      }),
    ).rejects.toThrow(NotFoundException);

    expect(savedRows).toHaveLength(0);
  });

  it('refuses to READ a mapping for an organization that is not a subsidiary of the caller', async () => {
    const { service, mapRepository } = build({ linked: true });

    await expect(service.getMapForSubsidiary(PARENT, VICTIM)).rejects.toThrow(NotFoundException);
    expect(mapRepository.find).not.toHaveBeenCalled();
  });

  /**
   * «No existe» y «no es tuya» responden lo mismo a propósito: distinguirlas permitiría enumerar
   * qué empresas hay en el producto probando identificadores.
   */
  it('answers the same for an organization that does not exist as for one that is not yours', async () => {
    const { service } = build({ linked: false });

    const denied = await service.getMapForSubsidiary(PARENT, SUBSIDIARY).catch((e) => e);
    const unknown = await service.getMapForSubsidiary(PARENT, 'no-such-org').catch((e) => e);

    expect(denied).toBeInstanceOf(NotFoundException);
    expect(unknown).toBeInstanceOf(NotFoundException);
    expect((denied as Error).message).toBe((unknown as Error).message);
  });

  /**
   * Comprobar el vínculo padre-subsidiaria es necesario y no suficiente: `mappings[]` nombra dos
   * cuentas por fila, y sin comprobarlas un miembro legítimo del grupo podría apuntar
   * `parentAccountId` a una cuenta de una tercera empresa.
   */
  it('refuses a mapping whose accounts belong to the wrong company', async () => {
    const { service, savedRows } = build({
      linked: true,
      accountOrgs: { 'sub-account': SUBSIDIARY, 'foreign-account': VICTIM },
    });

    await expect(
      service.createOrUpdateMap(PARENT, {
        subsidiaryOrganizationId: SUBSIDIARY,
        mappings: [{ subsidiaryAccountId: 'sub-account', parentAccountId: 'foreign-account' }],
      }),
    ).rejects.toThrow(NotFoundException);

    expect(savedRows).toHaveLength(0);
  });

  it('writes the mapping when the group link and both accounts check out', async () => {
    const { service, savedRows } = build({
      linked: true,
      accountOrgs: { 'sub-account': SUBSIDIARY, 'parent-account': PARENT },
    });

    await expect(
      service.createOrUpdateMap(PARENT, {
        subsidiaryOrganizationId: SUBSIDIARY,
        mappings: [{ subsidiaryAccountId: 'sub-account', parentAccountId: 'parent-account' }],
      }),
    ).resolves.toMatchObject({ params: { count: 1 } });

    expect(savedRows).toHaveLength(1);
  });
});
