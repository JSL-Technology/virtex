import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Currency } from './entities/currency.entity';
import { CreateCurrencyDto } from './dto/create-currency.dto';
import { UpdateCurrencyDto } from './dto/update-currency.dto';

@Injectable()
export class CurrenciesService {
  constructor(
    @InjectRepository(Currency)
    private readonly currencyRepository: Repository<Currency>,
  ) {}

  create(createCurrencyDto: CreateCurrencyDto) {
    const currency = this.currencyRepository.create(createCurrencyDto);
    return this.currencyRepository.save(currency);
  }

  findAll() {
    return this.currencyRepository.find({ order: { name: 'ASC' } });
  }

  findOne(id: string) {
    return this.currencyRepository.findOneBy({ id });
  }

  update(id: string, updateCurrencyDto: UpdateCurrencyDto) {
    return this.currencyRepository.update(id, updateCurrencyDto);
  }

  remove(id: string) {
    return this.currencyRepository.softDelete(id);
  }
}