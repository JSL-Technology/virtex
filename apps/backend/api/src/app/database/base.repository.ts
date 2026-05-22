
import {
  Repository,
  FindOptionsWhere,
  DeepPartial,
  FindManyOptions,
  FindOneOptions,
  ObjectLiteral,
  SaveOptions,
  RemoveOptions,
  UpdateResult,
  DeleteResult,
  QueryRunner,
} from 'typeorm';
import { RequestContext } from 'nestjs-request-context';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

export interface ITenanted {
  organizationId: string;
}

export class TenantedRepository<
  T extends ITenanted & ObjectLiteral,
> extends Repository<T> {
  private getOrganizationId(): string {
    const request = RequestContext.currentContext?.req;
    const organizationId = request?.user?.organizationId;

    if (!organizationId) {
      throw new ForbiddenException(
        'No se pudo determinar la organización para esta operación. Acceso denegado.',
      );
    }
    return organizationId;
  }

  private applyTenantToWhere(
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  ): FindOptionsWhere<T> | FindOptionsWhere<T>[] {
    const organizationId = this.getOrganizationId();
    const tenantFilter = { organizationId } as FindOptionsWhere<T>;

    if (Array.isArray(where)) {
      return where.map((w) => ({ ...w, ...tenantFilter }));
    }

    return { ...where, ...tenantFilter };
  }

  override async save<E extends DeepPartial<T>>(
    entities: E[],
    options?: SaveOptions,
  ): Promise<E[]>;
  override async save<E extends DeepPartial<T>>(
    entity: E,
    options?: SaveOptions,
  ): Promise<E>;
  override async save<E extends DeepPartial<T>>(
    entityOrEntities: E | E[],
    options?: SaveOptions,
  ): Promise<E | E[]> {
    const organizationId = this.getOrganizationId();

    if (Array.isArray(entityOrEntities)) {
      entityOrEntities.forEach(
        (entity) => ((entity as ITenanted).organizationId = organizationId),
      );
    } else {
      (entityOrEntities as ITenanted).organizationId = organizationId;
    }

    return super.save(entityOrEntities as any, options);
  }

  override async update(
    criteria: FindOptionsWhere<T>,
    partialEntity: QueryDeepPartialEntity<T>,
  ): Promise<UpdateResult> {
    const tenantedCriteria = this.applyTenantToWhere(criteria);
    return super.update(tenantedCriteria, partialEntity);
  }

  override async delete(
    criteria: FindOptionsWhere<T>,
  ): Promise<DeleteResult> {
    const tenantedCriteria = this.applyTenantToWhere(criteria);
    return super.delete(tenantedCriteria);
  }
  
  override async remove(entities: T[], options?: RemoveOptions): Promise<T[]>;
  override async remove(entity: T, options?: RemoveOptions): Promise<T>;
  override async remove(
    entityOrEntities: T | T[],
    options?: RemoveOptions,
  ): Promise<T | T[]> {
    const organizationId = this.getOrganizationId();
    
    const ensureOwnership = (entity: T) => {
      if (entity.organizationId !== organizationId) {
        throw new ForbiddenException(
          'Intento de eliminar una entidad que no pertenece a la organización.',
        );
      }
    };

    if (Array.isArray(entityOrEntities)) {
      if (!entityOrEntities || entityOrEntities.length === 0) {
        return entityOrEntities;
      }
      entityOrEntities.forEach(ensureOwnership);
      return super.remove(entityOrEntities, options);
    } else {
      ensureOwnership(entityOrEntities);
      return super.remove(entityOrEntities, options);
    }
  }

  override find(options?: FindManyOptions<T>): Promise<T[]> {
    const newOptions = {
      ...options,
      where: this.applyTenantToWhere(options?.where),
    };
    return super.find(newOptions);
  }

  override findBy(where: FindOptionsWhere<T>): Promise<T[]> {
    const newWhere = this.applyTenantToWhere(where);
    return super.findBy(newWhere);
  }

  override findOne(options: FindOneOptions<T>): Promise<T | null> {
    const newOptions = {
      ...options,
      where: this.applyTenantToWhere(options.where),
    };
    return super.findOne(newOptions);
  }

  override findOneBy(where: FindOptionsWhere<T>): Promise<T | null> {
    const newWhere = this.applyTenantToWhere(where);
    return super.findOneBy(newWhere);
  }
  
  override findOneOrFail(options: FindOneOptions<T>): Promise<T> {
    const newOptions = {
      ...options,
      where: this.applyTenantToWhere(options.where),
    };
    return super.findOneOrFail(newOptions);
  }
  
  override findOneByOrFail(where: FindOptionsWhere<T>): Promise<T> {
    const newWhere = this.applyTenantToWhere(where);
    return super.findOneByOrFail(newWhere);
  }

  override count(options?: FindManyOptions<T>): Promise<number> {
    const newOptions = {
      ...options,
      where: this.applyTenantToWhere(options?.where),
    };
    return super.count(newOptions);
  }

  override countBy(where: FindOptionsWhere<T>): Promise<number> {
    const newWhere = this.applyTenantToWhere(where);
    return super.countBy(newWhere);
  }

  override createQueryBuilder(
    alias?: string,
    queryRunner?: QueryRunner,
  ): any {
    const organizationId = this.getOrganizationId();
    const qb = super.createQueryBuilder(alias, queryRunner);
    return qb.andWhere(`${alias || this.metadata.tableName}.organizationId = :organizationId`, {
      organizationId,
    });
  }
}