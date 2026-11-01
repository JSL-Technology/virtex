import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PriceList } from './entities/price-list.entity';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { PriceListItem } from './entities/price-list-item.entity';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { assertTenantOwns } from '../shared/tenancy/tenant-ownership';
import { roundAmount } from '../common/money';

type ItemInput = { productId: string; price: number };

@Injectable()
export class PriceListsService {
  constructor(
    @InjectRepository(PriceList)
    private readonly priceListRepository: Repository<PriceList>,
    private readonly dataSource: DataSource,
  ) {}

  async create(createPriceListDto: CreatePriceListDto, organizationId: string): Promise<PriceList> {
    const { items, ...priceListData } = createPriceListDto;
    this.assertValidWindow(priceListData.validFrom, priceListData.validTo);

    return this.dataSource.transaction(async (manager) => {
      await this.assertItems(manager, items, organizationId);
      const priceList = manager.create(PriceList, {
        ...priceListData,
        currency: priceListData.currency.trim().toUpperCase(),
        organizationId,
        items: this.toItems(items),
      } as never);
      return manager.save(priceList);
    });
  }

  findAll(organizationId: string): Promise<PriceList[]> {
    return this.priceListRepository.find({
      where: { organizationId },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<PriceList> {
    const priceList = await this.priceListRepository.findOne({
      where: { id, organizationId },
    });
    if (!priceList) {
      throw new NotFoundError('price_lists.price_list_with_id_not_found', { id });
    }
    return priceList;
  }

  async update(id: string, updatePriceListDto: UpdatePriceListDto, organizationId: string): Promise<PriceList> {
    return this.dataSource.transaction(async (manager) => {
      const priceList = await manager.findOne(PriceList, { where: { id, organizationId } });
      if (!priceList) {
        throw new NotFoundError('price_lists.price_list_with_id_not_found', { id });
      }

      const { items, ...priceListData } = updatePriceListDto;
      this.assertValidWindow(
        priceListData.validFrom ?? toIso(priceList.validFrom),
        priceListData.validTo ?? toIso(priceList.validTo),
      );

      Object.assign(priceList, priceListData);
      if (priceListData.currency) priceList.currency = priceListData.currency.trim().toUpperCase();

      if (items) {
        await this.assertItems(manager, items, organizationId);
        // Replace the lines wholesale: delete what was there, so a removed line does not survive
        // as an orphan pointing at the list.
        await manager.delete(PriceListItem, { priceListId: priceList.id });
        priceList.items = this.toItems(items);
      }

      return manager.save(priceList);
    });
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const priceList = await this.findOne(id, organizationId);
    await this.priceListRepository.remove(priceList);
  }

  /** Every product is this organization's, appears once, and has a non-negative price. */
  private async assertItems(manager: EntityManager, items: ItemInput[], organizationId: string): Promise<void> {
    const ids = items.map((item) => item.productId);
    const duplicates = ids.filter((productId, index) => ids.indexOf(productId) !== index);
    if (duplicates.length > 0) {
      throw new BadRequestError('price_lists.duplicate_product', { productId: duplicates[0] });
    }
    await assertTenantOwns(manager, 'products', ids, organizationId, {
      errorKey: 'price_lists.product_not_found',
      field: 'items',
    });
  }

  private toItems(items: ItemInput[]): PriceListItem[] {
    return items.map((item) =>
      Object.assign(new PriceListItem(), { productId: item.productId, price: roundAmount(item.price) }),
    );
  }

  private assertValidWindow(validFrom: string, validTo: string): void {
    if (validFrom && validTo && validFrom > validTo) {
      throw new BadRequestError('price_lists.valid_to_before_valid_from');
    }
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
