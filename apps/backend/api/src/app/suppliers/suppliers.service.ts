import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { DataSource } from 'typeorm';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import { NotFoundError, UnprocessableEntityError } from '../i18n/localized.exception';
import { IdentityDocumentService } from '../localization/services/identity-document.service';
import { TenantCountryResolver } from '../shared/tenancy/tenant-country.resolver';
import { likeTerm } from '../common/database/search-term';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
    private readonly dataSource: DataSource,
    private readonly saasService: SaasService,
    private readonly identityDocuments: IdentityDocumentService,
    private readonly tenantCountry: TenantCountryResolver,
  ) {}

  /**
   * Resolve and validate the supplier's fiscal identifier, and settle its country.
   *
   * Purchasing had exactly the gap sales did: a `taxId` varchar with no type beside it and no
   * validation behind it, so a mistyped RNC was stored and only surfaced when the 606 filing built
   * from it was rejected. It also carried `country` with `DEFAULT 'DO'`, which made every supplier
   * a Chilean tenant created Dominican — and "domestic or abroad" is the one question that column
   * exists to answer, so a wrong default there is a wrong filing.
   *
   * Both are settled here, from the tenant's country rather than from a constant.
   */
  private async resolveIdentityDocument(
    dto: Partial<CreateSupplierDto>,
    organizationId: string,
    existing?: Supplier,
  ): Promise<Partial<Supplier>> {
    const tenantCountry = await this.tenantCountry.resolve(organizationId);
    const country = dto.country ?? existing?.country ?? tenantCountry;

    if (!dto.taxId?.trim()) {
      return { country, identityDocumentTypeCode: null, identityDocumentCountry: null };
    }

    const resolved = await this.identityDocuments.resolveParty({
      value: dto.taxId,
      typeCode: dto.identityDocumentTypeCode,
      // A supplier's document is issued where the supplier is, which for a payment abroad is not
      // where the tenant is.
      documentCountry: dto.identityDocumentCountry ?? country,
      fallbackCountry: tenantCountry,
      appliesTo: 'both',
      usedFor: 'invoicing',
    });

    if (!resolved.ok) {
      switch (resolved.reason) {
        case 'type_required':
          throw new UnprocessableEntityError('masters.supplier_form.document_type_required', {
            country: resolved.country,
          });
        case 'type_not_issued':
          throw new UnprocessableEntityError('masters.supplier_form.document_type_not_issued', {
            code: resolved.code,
            country: resolved.country,
          });
        default:
          throw new UnprocessableEntityError('masters.supplier_form.document_invalid', {
            document: resolved.documentLabel,
          });
      }
    }

    return {
      country,
      taxId: resolved.value ?? undefined,
      identityDocumentTypeCode: resolved.typeCode,
      identityDocumentCountry: resolved.countryCode,
    };
  }

  /** Create a supplier, metered in the same transaction as the insert. */
  async create(
    createSupplierDto: CreateSupplierDto,
    organizationId: string,
  ): Promise<Supplier> {
    // Before the transaction: a rejected tax id should not have held a lock or consumed the
    // plan-limit check on its way to failing.
    const identity = await this.resolveIdentityDocument(createSupplierDto, organizationId);

    return this.dataSource.transaction(async (manager) => {
      await this.saasService.enforceLimit(manager, organizationId, SaasResource.SUPPLIERS);

      const supplier = manager.create(Supplier, {
        ...createSupplierDto,
        ...identity,
        organizationId,
      });
      return manager.save(supplier);
    });
  }

  /**
   * Los proveedores del inquilino, opcionalmente acotados.
   *
   * Ambos parámetros opcionales, y omitirlos es el comportamiento de siempre. Existen para los
   * selectores de proveedor del pedido de compra y de la factura de proveedor, que se traían la
   * lista entera.
   */
  findAll(
    organizationId: string,
    options: { search?: string; limit?: number } = {},
  ): Promise<Supplier[]> {
    const query = this.supplierRepository
      .createQueryBuilder('supplier')
      .where('supplier.organizationId = :organizationId', { organizationId })
      .orderBy('supplier.name', 'ASC');

    const term = likeTerm(options.search);
    if (term) {
      query.andWhere(
        '(supplier.name ILIKE :term OR supplier.taxId ILIKE :term OR supplier.email ILIKE :term)',
        { term },
      );
    }

    if (options.limit !== undefined && options.limit > 0) {
      query.take(options.limit);
    }

    return query.getMany();
  }

  async findOne(id: string, organizationId: string): Promise<Supplier> {
    const supplier = await this.supplierRepository.findOne({
      where: { id, organizationId },
    });
    if (!supplier) {
      throw new NotFoundError('suppliers.supplier_id_not_found', { id });
    }
    return supplier;
  }

  async update(
    id: string,
    updateSupplierDto: UpdateSupplierDto,
    organizationId: string,
  ): Promise<Supplier> {
    const supplier = await this.findOne(id, organizationId);

    // Re-validate when any of the three moves: correcting the TYPE alone has to re-check the value
    // against the new rule, and moving the supplier's COUNTRY changes which registry issued it.
    const identityTouched =
      updateSupplierDto.taxId !== undefined ||
      updateSupplierDto.identityDocumentTypeCode !== undefined ||
      updateSupplierDto.identityDocumentCountry !== undefined ||
      updateSupplierDto.country !== undefined;

    const updatedSupplier = this.supplierRepository.merge(supplier, updateSupplierDto);
    if (identityTouched) {
      Object.assign(
        updatedSupplier,
        await this.resolveIdentityDocument(
          {
            taxId: updateSupplierDto.taxId ?? supplier.taxId,
            identityDocumentTypeCode:
              updateSupplierDto.identityDocumentTypeCode ?? supplier.identityDocumentTypeCode ?? undefined,
            identityDocumentCountry:
              updateSupplierDto.identityDocumentCountry ?? supplier.identityDocumentCountry ?? undefined,
            country: updateSupplierDto.country ?? supplier.country ?? undefined,
          },
          organizationId,
          supplier,
        ),
      );
    }
    return this.supplierRepository.save(updatedSupplier);
  }

  /**
   * Delete a supplier, and give the seat of quota back.
   *
   * `SUPPLIERS` is a LIFETIME quota, so without the release it counted "suppliers ever created"
   * rather than "suppliers that exist" — a tenant at its limit could delete every record it had
   * and still be unable to create one. Both happen in the same transaction, so a failed delete
   * cannot hand out free quota.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    const supplier = await this.findOne(id, organizationId);
    await this.dataSource.transaction(async (manager) => {
      await manager.remove(Supplier, supplier);
      await this.saasService.releaseUsage(manager, organizationId, SaasResource.SUPPLIERS);
    });
  }
}