
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PriceList } from './entities/price-list.entity';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { PriceListItem } from './entities/price-list-item.entity';

@Injectable()
export class PriceListsService {
  constructor(
    @InjectRepository(PriceList)
    private readonly priceListRepository: Repository<PriceList>,
  ) {}

  async create(createPriceListDto: CreatePriceListDto, organizationId: string): Promise<PriceList> {
    const { items, ...priceListData } = createPriceListDto;
    const priceList = this.priceListRepository.create({
      ...priceListData,
      organizationId,
      items: items.map(itemDto => Object.assign(new PriceListItem(), itemDto)),
    });
    return this.priceListRepository.save(priceList);
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
      throw new NotFoundException(`Price list with ID "${id}" not found.`);
    }
    return priceList;
  }

  async update(id: string, updatePriceListDto: UpdatePriceListDto, organizationId: string): Promise<PriceList> {
    const priceList = await this.findOne(id, organizationId);
    
    const { items, ...priceListData } = updatePriceListDto;

    Object.assign(priceList, priceListData);

    if (items) {

      priceList.items = items.map(itemDto => Object.assign(new PriceListItem(), itemDto));
    }
    
    return this.priceListRepository.save(priceList);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const priceList = await this.findOne(id, organizationId);
    await this.priceListRepository.remove(priceList);
  }
}